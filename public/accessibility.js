// Keep native keyboard focus visible around Studio's sticky controls.
// This module changes presentation only; it never reads credentials or calls APIs.
const root=document.documentElement;
const header=document.querySelector('.topbar'),modes=document.querySelector('.mode-row'),toolbar=document.getElementById('toolbar');
function measure(){
 root.style.setProperty('--studio-header-height',(header?.getBoundingClientRect().height||60)+'px');
 root.style.setProperty('--studio-top-clearance',((header?.getBoundingClientRect().height||60)+(modes?.getBoundingClientRect().height||50)+24)+'px');
 root.style.setProperty('--studio-bottom-clearance',((toolbar?.getBoundingClientRect().height||100)+16)+'px');
}
const observer=new ResizeObserver(measure);
for(const n of [header,modes,toolbar])if(n)observer.observe(n);
measure();
let frame=0;
document.addEventListener('focusin',event=>{
 cancelAnimationFrame(frame);
 const target=event.target;
 if(!(target instanceof Element)||target.closest('dialog,.topbar,.mode-row,#toolbar'))return;
 frame=requestAnimationFrame(()=>{
  if(document.activeElement!==target||!target.isConnected)return;
  const r=target.getBoundingClientRect();
  const top=(header?.getBoundingClientRect().bottom||0)+(modes?.getBoundingClientRect().height||0)+16;
  const bottom=innerHeight-(toolbar?.getBoundingClientRect().height||0)-16;
  let clipped=r.top<top||r.bottom>bottom;
  for(let parent=target.parentElement;parent&&parent!==document.body;parent=parent.parentElement){
   const style=getComputedStyle(parent),box=parent.getBoundingClientRect();
   if(['auto','scroll','hidden','clip'].includes(style.overflowY)&&(r.top<box.top||r.bottom>box.bottom))clipped=true;
  }
  if(clipped)target.scrollIntoView({block:'center',inline:'nearest',behavior:'instant'});
 });
});
