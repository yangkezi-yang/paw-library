const $ = s => document.querySelector(s);
const fmtSize = n => n < 1024*1024 ? `${Math.max(1,Math.round(n/1024))} KB` : `${(n/1024/1024).toFixed(1)} MB`;
const fmtDate = d => new Date(d).toLocaleDateString('zh-CN',{year:'numeric',month:'2-digit',day:'2-digit'});
function escapeHTML(s=''){return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
async function loadResources(){
  try{
    const r=await fetch('/api/resources'); if(!r.ok) throw new Error('load failed'); const data=await r.json();
    $('#videoCount').textContent=data.videos.length; $('#docCount').textContent=data.documents.length;
    $('#videoGrid').innerHTML=data.videos.length?data.videos.map(v=>`<article class="video-card"><div class="video-frame"><video controls preload="metadata" playsinline src="${v.url}"></video></div><div class="video-info"><h3 title="${escapeHTML(v.title)}">${escapeHTML(v.title)}</h3><p>${escapeHTML(v.description||'')}</p><div class="video-date">上传于 ${fmtDate(v.createdAt)}</div></div></article>`).join(''):`<div class="empty-state"><span>🐱</span><b>这里还没有视频哦</b><small>从后台上传第一支视频，让小屋热闹起来吧。</small><a href="/admin.html">去上传视频　↗</a></div>`;
    $('#documentList').innerHTML=data.documents.length?data.documents.map(d=>`<article class="document-card"><div class="file-icon">${escapeHTML((d.originalName.split('.').pop()||'FILE').toUpperCase().slice(0,5))}</div><div class="document-info"><b title="${escapeHTML(d.title)}">${escapeHTML(d.title)}</b><small>${fmtSize(d.size)} · ${fmtDate(d.createdAt)}${d.description?' · '+escapeHTML(d.description):''}</small></div><a class="download-button" href="${d.url}" download="${encodeURIComponent(d.originalName)}">↓ 下载</a></article>`).join(''):`<div class="empty-state"><span>📄</span><b>文档架还是空的</b><small>上传 PDF、Word、Excel 等文件后，会显示在这里。</small><a href="/admin.html">去上传文档　↗</a></div>`;
  }catch(e){$('#videoGrid').innerHTML='<div class="empty-state"><b>暂时无法连接服务器</b><small>请确认网站服务已启动。</small></div>';}
}
$('#year').textContent=new Date().getFullYear();loadResources();
