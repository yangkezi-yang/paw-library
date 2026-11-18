import React,{useEffect,useState} from 'react';
import {Cat} from 'lucide-react';
export default function Avatar({src,name='',className=''}:{src?:string|null;name?:string;className?:string}){
 const [failed,setFailed]=useState(false);useEffect(()=>setFailed(false),[src]);
 return <span className={'avatar '+className}>{src&&!failed?<img src={src} alt={name?name+'的头像':'头像'} onError={()=>setFailed(true)}/>:<Cat aria-hidden="true"/>}</span>;
}
