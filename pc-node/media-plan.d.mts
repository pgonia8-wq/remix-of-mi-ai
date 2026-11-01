export type AdvancedClip={start:number;end:number;transition:'cut'|'fade'|'wipeleft'|'slideright'|'circleopen';transitionSeconds:number};
export type VideoOverlay={assetId:string;name:string;offset:number;length:number;scale:number;x:number;y:number;endX:number;endY:number};
export type VideoPlan={clips:AdvancedClip[];overlays:VideoOverlay[];width:number;height:number;audio?:boolean};
export function videoArgs(plan:VideoPlan,inputs:string[],output:string):{args:string[];duration:number};
