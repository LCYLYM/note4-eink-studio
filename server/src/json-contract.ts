import {z} from 'zod';
import {problem} from './accounts';
/** Deliberately bounded JSON Schema subset; unsupported keywords fail visibly. */
export function jsonContract(s:any,depth=0):z.ZodTypeAny{
 if(depth>6||!s||typeof s!=='object'||Array.isArray(s))problem('JSON契约不合法或层级过深');
 const known=['type','properties','required','additionalProperties','items','enum','minimum','maximum','minLength','maxLength','minItems','maxItems','description'];
 if(Object.keys(s).some(k=>!known.includes(k)))problem('JSON契约含暂不支持的关键字');
 let result:z.ZodTypeAny;
 switch(s.type){
 case'object':{const properties=s.properties??{};if(Object.keys(properties).length>32)problem('JSON字段过多');const shape:Record<string,z.ZodTypeAny>={};for(const [k,v] of Object.entries(properties)){if(['__proto__','constructor','prototype'].includes(k))problem('JSON字段名不可用');let field=jsonContract(v,depth+1);if(!(s.required??[]).includes(k))field=field.optional();shape[k]=field;}result=s.additionalProperties===true?z.object(shape).passthrough():z.object(shape).strict();break;}
 case'array':result=z.array(jsonContract(s.items,depth+1)).min(s.minItems??0).max(Math.min(100,s.maxItems??100));break;
 case'string':result=z.string().min(s.minLength??0).max(Math.min(8000,s.maxLength??8000));break;
 case'number':case'integer':{let n=z.number().finite();if(s.type==='integer')n=n.int();if(s.minimum!==undefined)n=n.min(s.minimum);if(s.maximum!==undefined)n=n.max(s.maximum);result=n;break;}
 case'boolean':result=z.boolean();break;
 case'null':result=z.null();break;
 default:problem('JSON契约需明确type');
 }
 if(s.enum){if(!Array.isArray(s.enum)||!s.enum.length||s.enum.length>32)problem('enum不合法');const values=s.enum.map((x:any)=>JSON.stringify(x));result=result.refine(x=>values.includes(JSON.stringify(x)),'不在允许值中');}
 return result;
}
