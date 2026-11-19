// net.request({key,url,method,headers,body,keep}); the reply arrives later through on_net(key,status,body).
// Shared by the device and the WASM preview, so both accept exactly the same requests.
static char *net_field(JSContext *c, JSValue *obj, const char *name, size_t max, size_t *out, bool *bad) {
    JSValue v = JS_GetPropertyStr(c, *obj, name);
    *out = 0;
    if (JS_IsUndefined(v) || JS_IsNull(v)) return NULL;
    JSCStringBuf buf; size_t len; const char *s = JS_ToCStringLen(c, &len, v, &buf);
    if (!s || len > max) { *bad = true; return NULL; }
    char *copy = NET_ALLOC(len + 1);
    if (!copy) { *bad = true; return NULL; }
    memcpy(copy, s, len); copy[len] = 0; *out = len;
    return copy;
}
static JSValue js_net_request(JSContext *c, JSValue *t, int argc, JSValue *argv) {
    argc &= ~FRAME_CF_CTOR;
    if (argc < 1) return JS_ThrowTypeError(c, "net.request needs an object");
    bool bad = false; size_t klen, ulen, mlen, hlen, blen; int keep = 0;
    char *key = net_field(c, &argv[0], "key", 16, &klen, &bad), *url = net_field(c, &argv[0], "url", 1024, &ulen, &bad),
         *method = net_field(c, &argv[0], "method", 7, &mlen, &bad), *headers = net_field(c, &argv[0], "headers", 2048, &hlen, &bad),
         *body = net_field(c, &argv[0], "body", 16384, &blen, &bad);
    JSValue k = JS_GetPropertyStr(c, argv[0], "keep");
    if (!JS_IsUndefined(k)) JS_ToInt32(c, &keep, k);
    bool ok = !bad && key && url && klen && (!strncmp(url, "http://", 7) || !strncmp(url, "https://", 8));
    for (size_t i = 0; ok && i < klen; i++) ok = (key[i] >= 'a' && key[i] <= 'z') || (key[i] >= '0' && key[i] <= '9') || key[i] == '_';
    bool queued = ok && n4_net_enqueue(app_ns, key, url, method ? method : (body ? "POST" : "GET"), headers ? headers : "", body ? body : "", blen, keep != 0, user_call);
    NET_FREE(key); NET_FREE(url); NET_FREE(method); NET_FREE(headers); NET_FREE(body);
    if (!ok) return JS_ThrowTypeError(c, "net.request: key is 1-16 of a-z0-9_, url starts with http:// or https://, url up to 1024 bytes, headers 2048, body 16384");
    return JS_NewBool(queued);
}
