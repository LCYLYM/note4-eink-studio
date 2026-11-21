// Shared declarative Agent bridge (included by firmware/main/js_app.c and wasm/note4_vm.c).
// Expects: ctx, JS_AGENT_ARM_DEADLINE() macro before JS_Call/JS_Eval, JS_AGENT_REPORT_ERR(where).
#ifndef JS_AGENT_ARM_DEADLINE
#define JS_AGENT_ARM_DEADLINE() ((void)0)
#endif

static bool ag_configured = false;
static char ag_role_buf[640];
static char ag_tools_schema[6144];
static char ag_status_str[24] = "idle";
static char ag_say_buf[384];
static bool ag_say_pending = false;
static int ag_tool_count = 0;

static size_t ag_utf8_clip(const char *src, size_t len, char *dst, size_t cap) {
    if (!cap) return 0;
    if (!src) { dst[0] = 0; return 0; }
    size_t n = len < cap - 1 ? len : cap - 1;
    if (n < len) {
        while (n > 0 && ((unsigned char)src[n] & 0xC0) == 0x80) n--;
    }
    memcpy(dst, src, n);
    dst[n] = 0;
    return n;
}

static void ag_reset_state(void) {
    ag_configured = false;
    ag_role_buf[0] = 0;
    strcpy(ag_tools_schema, "[]");
    strcpy(ag_status_str, "idle");
    ag_say_buf[0] = 0;
    ag_say_pending = false;
    ag_tool_count = 0;
}

// Normalizes compact params ({text:'string:事项', index:'number?:序号'}) into OpenAI function tools + sample args.
static const char kAgNormalizeJs[] =
    "(function(s){"
    "if(!s||typeof s!=='object')throw TypeError('agent.config expects object');"
    "var role=String(s.role||'').trim();"
    "if(!role||role.length>600)throw TypeError('agent.config role required (<=600 chars)');"
    "if(s.state!==undefined&&typeof s.state!=='function')throw TypeError('agent.config state must be function');"
    "if(s.on_event!==undefined&&typeof s.on_event!=='function')throw TypeError('agent.config on_event must be function');"
    "var ts=s.tools||[];if(!Array.isArray(ts)||ts.length>12)throw TypeError('agent.config tools must be array <=12');"
    "var defs=[],samples=[],seen={};"
    "for(var i=0;i<ts.length;i++){"
    "var t=ts[i];if(!t||typeof t!=='object')throw TypeError('tool '+i+' must be object');"
    "var nm=String(t.name||'');"
    "if(!/^[a-zA-Z_][a-zA-Z0-9_]{0,31}$/.test(nm)||seen[nm])throw TypeError('bad/dup tool name: '+nm);"
    "seen[nm]=1;"
    "var ds=String(t.desc||t.description||'').trim();"
    "if(!ds||ds.length>200)throw TypeError('tool '+nm+' desc required');"
    "if(typeof t.run!=='function')throw TypeError('tool '+nm+' run must be function');"
    "var pr=t.params||{},props={},req=[],smp={};"
    "if(pr.type==='object'&&pr.properties){props=pr.properties;req=pr.required||[];}"
    "else{var ks=Object.keys(pr);for(var j=0;j<ks.length;j++){"
    "var k=ks[j],v=pr[k];"
    "if(typeof v==='string'){"
    "var c=v.indexOf(':'),head=c>=0?v.slice(0,c):v,pdesc=c>=0?v.slice(c+1):'';"
    "var opt=head.charAt(head.length-1)==='?';if(opt)head=head.slice(0,-1);"
    "if(head!=='string'&&head!=='number'&&head!=='integer'&&head!=='boolean')head='string';"
    "props[k]=pdesc?{type:head,description:pdesc}:{type:head};"
    "if(!opt)req.push(k);"
    "smp[k]=head==='number'||head==='integer'?0:head==='boolean'?true:'示例';"
    "}else if(v&&typeof v==='object'){props[k]=v;smp[k]=v.type==='number'||v.type==='integer'?0:v.type==='boolean'?true:'示例';}"
    "}}"
    "defs.push({type:'function',function:{name:nm,description:ds,parameters:{type:'object',properties:props,required:req}}});"
    "samples.push(smp);"
    "}"
    "globalThis.__n4_ag={spec:s,samples:samples,"
    "readState:function(){if(!s.state)return '{}';var r=s.state();return r===undefined?'{}':JSON.stringify(r);},"
    "callTool:function(n,aj){var a=aj?JSON.parse(aj):{};for(var i=0;i<ts.length;i++)if(ts[i].name===n){var r=ts[i].run(a||{});return r===undefined?'{\"ok\":true}':typeof r==='string'?r:JSON.stringify(r);}return '{\"error\":\"unknown_tool\"}';},"
    "probeIdx:function(i){var r=ts[i].run(samples[i]);return r===undefined?'{\"ok\":true}':JSON.stringify(r);},"
    "emit:function(ph,tx){if(s.on_event)s.on_event({phase:ph,text:tx||''});}"
    "};"
    "return role+'\\n'+ts.length+'\\n'+JSON.stringify(defs);"
    "})";

static JSValue js_agent_config(JSContext *c, JSValue *t, int argc, JSValue *argv) {
    argc &= ~FRAME_CF_CTOR;
    if (argc < 1) return JS_ThrowTypeError(c, "agent.config(spec) requires 1 argument");
    JSGCRef arg_ref; JS_PushGCRef(c, &arg_ref); arg_ref.val = argv[0];
    JSValue fn = JS_Eval(c, kAgNormalizeJs, sizeof(kAgNormalizeJs) - 1, "<agent>", JS_EVAL_RETVAL);
    JSValue spec_val = JS_PopGCRef(c, &arg_ref);
    if (JS_IsException(fn)) return JS_EXCEPTION;
    if (JS_StackCheck(c, 3)) return JS_EXCEPTION;
    JS_PushArg(c, spec_val);
    JS_PushArg(c, fn);
    JS_PushArg(c, JS_NULL);
    JSValue res = JS_Call(c, 1);
    if (JS_IsException(res)) return JS_EXCEPTION;
    JSCStringBuf buf; size_t len = 0;
    const char *s = JS_ToCStringLen(c, &len, res, &buf);
    if (!s) return JS_EXCEPTION;
    const char *nl1 = memchr(s, '\n', len);
    const char *nl2 = nl1 ? memchr(nl1 + 1, '\n', len - (size_t)(nl1 - s) - 1) : NULL;
    if (!nl1 || !nl2) return JS_ThrowInternalError(c, "agent meta parse");
    size_t jlen = len - (size_t)(nl2 + 1 - s);
    if (jlen >= sizeof(ag_tools_schema)) return JS_ThrowRangeError(c, "agent tools schema exceeds 6KB");
    ag_utf8_clip(s, (size_t)(nl1 - s), ag_role_buf, sizeof(ag_role_buf));
    ag_tool_count = atoi(nl1 + 1);
    memcpy(ag_tools_schema, nl2 + 1, jlen);
    ag_tools_schema[jlen] = 0;
    ag_configured = true;
    return JS_TRUE;
}

static JSValue js_agent_say(JSContext *c, JSValue *t, int argc, JSValue *argv) {
    argc &= ~FRAME_CF_CTOR;
    if (argc < 1) return JS_UNDEFINED;
    JSCStringBuf buf; size_t len = 0;
    const char *s = JS_ToCStringLen(c, &len, argv[0], &buf);
    if (!s) return JS_EXCEPTION;
    ag_utf8_clip(s, len, ag_say_buf, sizeof(ag_say_buf));
    ag_say_pending = ag_say_buf[0] != 0;
    return JS_UNDEFINED;
}

static JSValue js_agent_status(JSContext *c, JSValue *t, int argc, JSValue *argv) {
    (void)t; (void)argc; (void)argv;
    return JS_NewString(c, ag_status_str);
}

static bool ag_invoke_helper(const char *method, const char *a1, const char *a2, int int_arg, char *out, size_t cap) {
    if (!ctx || !ag_configured) return false;
    JSValue g = JS_GetGlobalObject(ctx);
    JSValue holder = JS_GetPropertyStr(ctx, g, "__n4_ag");
    if (JS_IsUndefined(holder) || JS_IsNull(holder)) return false;
    if (JS_StackCheck(ctx, 5)) { JS_AGENT_REPORT_ERR(method); return false; }
    int nargs = 0;
    if (int_arg >= 0) {
        JS_PushArg(ctx, JS_NewInt32(ctx, int_arg));
        nargs = 1;
    } else if (a1 && a2) {
        JS_PushArg(ctx, JS_NewString(ctx, a2));
        JS_PushArg(ctx, JS_NewString(ctx, a1));
        nargs = 2;
    } else if (a1) {
        JS_PushArg(ctx, JS_NewString(ctx, a1));
        nargs = 1;
    }
    g = JS_GetGlobalObject(ctx);
    holder = JS_GetPropertyStr(ctx, g, "__n4_ag");
    JSValue fn = JS_GetPropertyStr(ctx, holder, method);
    if (!JS_IsFunction(ctx, fn)) return false;
    JS_PushArg(ctx, fn);
    JS_PushArg(ctx, holder);
    JS_AGENT_ARM_DEADLINE();
    JSValue r = JS_Call(ctx, nargs);
    if (JS_IsException(r)) { JS_AGENT_REPORT_ERR(method); return false; }
    if (out && cap) {
        if (JS_IsUndefined(r) || JS_IsNull(r)) { ag_utf8_clip("{}", 2, out, cap); }
        else {
            JSCStringBuf buf; size_t len = 0;
            const char *s = JS_ToCStringLen(ctx, &len, r, &buf);
            if (!s) { JS_AGENT_REPORT_ERR(method); return false; }
            ag_utf8_clip(s, len, out, cap);
        }
    }
    return true;
}
