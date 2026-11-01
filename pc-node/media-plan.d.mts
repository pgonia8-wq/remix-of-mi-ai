export type AdvancedClip={start:number;end:number;transition:'cut'|'fade'|'wipeleft'|'slideright'|'circleopen';transitionSeconds:number};
export type VideoOverlay={assetId:string;name:string;offset:number;length:number;scale:number;x:number;y:number;endX:number;endY:number};
export type VideoPlan={clips:AdvancedClip[];overlays:VideoOverlay[];width:number;height:number;audio?:boolean;originalAudio?:boolean;mute?:boolean;rotation?:number;hasAudio?:boolean[];captions?:{start:number;end:number;text:string}[];captionFiles?:{start:number;end:number;file:string}[]};
export function videoArgs(plan:VideoPlan,inputs:string[],output:string):{args:string[];duration:number};
