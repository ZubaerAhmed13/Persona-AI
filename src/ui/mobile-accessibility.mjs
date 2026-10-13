// Stage 9: accessible focus, route semantics and mobile rail. No storage/network requests.

export function personaV4Stage9Focusable(root) {
  if (!root) return [];
  return Array.from(root.querySelectorAll('a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])'))
    .filter(el => !el.hidden && !el.closest("[hidden], [inert]") && el.getClientRects().length > 0 &&
      window.getComputedStyle(el).visibility !== "hidden");
}

export function personaV4Stage9HandleModalKey(event, backdrop, onClose) {
  if(!backdrop?.isConnected)return;
  if(event.key==="Escape") {
    event.preventDefault();
    event.stopPropagation();
    onClose();
    return;
  }
  if(event.key!=="Tab")return;
  const items=personaV4Stage9Focusable(backdrop);
  if(!items.length){event.preventDefault();backdrop.focus();return;}
  const first=items[0],last=items[items.length-1];
  const focused=document.activeElement;
  if(!backdrop.contains(focused)){event.preventDefault();(event.shiftKey?last:first).focus();return;}
  if(event.shiftKey&&focused===first){event.preventDefault();last.focus();}
  else if(!event.shiftKey&&focused===last){event.preventDefault();first.focus();}
}

export function personaV4Stage9SyncMobileNav() {
  const nav=document.getElementById("v4MobileNav");
  if(!nav || window.innerWidth>720)return;
  const active=nav.querySelector('[aria-current="page"]');
  if(!active)return;
  const left=active.offsetLeft, right=left+active.offsetWidth;
  const visibleLeft=nav.scrollLeft, visibleRight=visibleLeft+nav.clientWidth;
  if(left < visibleLeft)nav.scrollLeft=Math.max(0,left-8);
  else if(right>visibleRight)nav.scrollLeft=Math.min(nav.scrollWidth-nav.clientWidth,right-nav.clientWidth+8);
}

export function personaV4Stage9EnhanceView(view) {
  const title=document.querySelector("#view .page-title");
  if(title){
    title.setAttribute("role","heading");
    title.setAttribute("aria-level","1");
    title.id="v4s9ViewHeading";
    document.getElementById("main")?.setAttribute("aria-labelledby","v4s9ViewHeading");
  }
  if(!document.getElementById("v4s9SkipLink")){
    const link=document.createElement("a");
    link.id="v4s9SkipLink";link.className="v4s9-skip-link";
    link.href="#main";link.textContent="Skip to main content";
    document.body.prepend(link);
  }
  const menu=document.getElementById("menuBtn"),sidebar=document.getElementById("sidebar");
  if(menu&&sidebar&&!menu.dataset.v4s9Installed){
    menu.dataset.v4s9Installed="true";
    menu.setAttribute("aria-controls","sidebar");
    menu.setAttribute("aria-expanded",String(sidebar.classList.contains("open")));
    menu.addEventListener("click",()=>{
      menu.setAttribute("aria-expanded",String(sidebar.classList.contains("open")));
    });
    document.addEventListener("keydown",e=>{
      if(e.key==="Escape"&&sidebar.classList.contains("open")&&!document.querySelector("#modalRoot .modal-backdrop")){
        sidebar.classList.remove("open");
        menu.setAttribute("aria-expanded","false");
        menu.focus();
      }
    });
  }
  if(menu&&sidebar)menu.setAttribute("aria-expanded",String(sidebar.classList.contains("open")));
  personaV4Stage9SyncMobileNav();
}

export function personaV4Stage9FocusRoute() {
  const title=document.querySelector("#view .page-title");
  if(!title)return;
  title.setAttribute("tabindex","-1");
  title.focus({preventScroll:true});
  const main=document.getElementById("main");
  if(main)main.scrollTop=0;
}
