export function avatarURL(id:string,version:string|null|undefined){return version?'/api/avatar?id='+encodeURIComponent(id)+'&v='+encodeURIComponent(version):null}
