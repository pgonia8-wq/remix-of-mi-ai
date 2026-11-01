declare module '@jscad/stl-serializer' { export function serialize(options:{binary:boolean},...solids:unknown[]):(ArrayBuffer|string)[]; }
declare module '@jscad/obj-serializer' { export function serialize(options:Record<string,unknown>,...solids:unknown[]):string[]; }
