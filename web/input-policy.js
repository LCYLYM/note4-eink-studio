export function filterInput(mask,mappings=['ok.short','gesture.wave']){
 if(!mappings.includes('ok.short'))mask&=~7;
 if(!mappings.includes('gesture.wave'))mask&=~56;
 return mask;
}
export function canRetry(mask,mappings){return !(mask&128)&&!!(filterInput(mask,mappings)&15);}
export function inputMode(mappings=['ok.short','gesture.wave']){return mappings.includes('ok.short')?(mappings.includes('gesture.wave')?'both':'buttons'):'gestures';}
