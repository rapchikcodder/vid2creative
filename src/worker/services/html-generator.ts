import { CreativeConfig, TimelineEvent, CTAButton, OverlayElement, AnimationType } from '../types';

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function ctaTag(cta: CTAButton, _animation: AnimationType, clickUrl: string, extraClasses: string, dataAttrs: string): string {
  const action = cta.action || 'link';
  if (action === 'link') {
    return `<a href="${escapeHtml(clickUrl)}" target="_blank" rel="noopener" class="cta-btn ${extraClasses} ${cta.size} ${cta.style}" style="left:${cta.position.x}%;top:${cta.position.y}%;" ${dataAttrs}>${escapeHtml(cta.text)}</a>`;
  }
  // Non-link actions use a button element with data-action
  return `<button class="cta-btn ${extraClasses} ${cta.size} ${cta.style}" style="left:${cta.position.x}%;top:${cta.position.y}%;" data-action="${action}" ${dataAttrs}>${escapeHtml(cta.text)}</button>`;
}

function buildCtaHtml(cta: CTAButton, animation: AnimationType, clickUrl: string): string {
  if (!cta.visible) return '';
  return `      ${ctaTag(cta, animation, clickUrl, `poster-cta anim-${animation}`, '')}`;
}

function buildOverlayHtml(overlay: OverlayElement): string {
  if (!overlay.visible || overlay.type === 'none') return '';
  const posClass = `pos-${overlay.position}`;
  return `      <div class="overlay-el poster-cta ${overlay.type} ${posClass} anim-fade-in">${escapeHtml(overlay.text)}</div>`;
}

function buildTimelineCtaHtml(event: TimelineEvent, clickUrl: string): string {
  const hideAt = event.timestamp + event.duration;
  const pauseAttr = event.pauseVideo ? ' data-pause="true"' : '';
  let html = '';
  if (event.cta.visible) {
    const dataAttrs = `data-show-at="${event.timestamp.toFixed(1)}" data-hide-at="${hideAt.toFixed(1)}" data-anim="${event.animation}"${pauseAttr}`;
    html += `      ${ctaTag(event.cta, event.animation, clickUrl, '', dataAttrs)}\n`;
  }
  if (event.overlay.visible && event.overlay.type !== 'none') {
    const posClass = `pos-${event.overlay.position}`;
    html += `      <div class="overlay-el ${event.overlay.type} ${posClass}" data-show-at="${event.timestamp.toFixed(1)}" data-hide-at="${hideAt.toFixed(1)}" data-anim="fade-in">${escapeHtml(event.overlay.text)}</div>\n`;
  }
  return html;
}

export function generateCreativeHtml(config: CreativeConfig, videoUrl: string, posterFrameUrl: string): string {
  // Smart crop: center on character using ML-detected focus point
  const focusX = config.focusX ?? 50;

  // Build poster CTAs from timeline events at the poster frame
  const posterEvents = config.timeline.filter(e => e.frameIndex === config.posterFrameIndex);
  let posterCtas = '';
  for (const ev of posterEvents) {
    posterCtas += buildCtaHtml(ev.cta, ev.animation, config.clickThroughUrl) + '\n';
    posterCtas += buildOverlayHtml(ev.overlay) + '\n';
  }
  // If no poster events, add a default CTA
  if (!posterCtas.trim()) {
    posterCtas = `      <a href="${escapeHtml(config.clickThroughUrl)}" target="_blank" rel="noopener" class="cta-btn poster-cta large pulse anim-pulse" style="left:50%;top:85%;">Play Now</a>`;
  }

  // Build timeline CTAs (excluding poster frame events)
  let timelineCtas = '';
  for (const ev of config.timeline.filter(e => e.frameIndex !== config.posterFrameIndex)) {
    timelineCtas += buildTimelineCtaHtml(ev, config.clickThroughUrl);
  }

  const mutedAttr = config.muteByDefault ? 'muted' : '';
  const loopAttr = config.loopVideo ? 'loop' : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1.0">
  <title>Interactive Creative</title>
  <style>
    *{margin:0;padding:0;box-sizing:border-box}
    body{background:#111;display:flex;justify-content:center;align-items:center;min-height:100vh}
    .creative{position:relative;width:${config.width}px;height:${config.height}px;overflow:hidden;background:${config.backgroundColor};cursor:pointer}
    .creative video{position:absolute;top:0;left:0;width:100%;height:100%;object-fit:cover;object-position:${focusX}% 50%}
    .poster-overlay{position:absolute;top:0;left:0;width:100%;height:100%;z-index:10;background-size:cover;background-position:${focusX}% 50%;transition:opacity .5s ease}
    .poster-overlay.hidden{opacity:0;pointer-events:none}
    .cta-btn{position:absolute;transform:translate(-50%,-50%);border:none;border-radius:8px;cursor:pointer;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:#fff;z-index:20;text-decoration:none;display:inline-flex;align-items:center;justify-content:center;opacity:0}
    .cta-btn.poster-cta{opacity:1}
    .cta-btn.small{padding:8px 16px;font-size:11px}
    .cta-btn.medium{padding:12px 28px;font-size:13px}
    .cta-btn.large{padding:16px 36px;font-size:16px;border-radius:12px}
    .cta-btn.primary{background:linear-gradient(135deg,#6c5ce7,#a29bfe);box-shadow:0 4px 20px rgba(108,92,231,.5)}
    .cta-btn.secondary{background:rgba(255,255,255,.15);backdrop-filter:blur(10px);border:1px solid rgba(255,255,255,.3)}
    .cta-btn.floating{background:linear-gradient(135deg,#00d2d3,#54a0ff);border-radius:50px;box-shadow:0 6px 25px rgba(0,210,211,.4)}
    .cta-btn.pulse{background:linear-gradient(135deg,#ff6b6b,#ee5a24);box-shadow:0 0 20px rgba(255,107,107,.4)}
    .cta-btn.glow{background:linear-gradient(135deg,#f9ca24,#f0932b);box-shadow:0 0 30px rgba(249,202,36,.5)}
    .cta-btn.slide-in{background:linear-gradient(135deg,#2d3436,#636e72)}
    .cta-btn.bounce{background:linear-gradient(135deg,#0984e3,#74b9ff)}
    .cta-btn.glass{background:rgba(255,255,255,.1);backdrop-filter:blur(20px);border:1px solid rgba(255,255,255,.2);box-shadow:0 8px 32px rgba(0,0,0,.3)}
    .overlay-el{position:absolute;z-index:15;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:12px;font-weight:600;color:#fff;opacity:0}
    .overlay-el.poster-cta{opacity:1}
    .overlay-el.badge{background:#ff6b6b;padding:4px 12px;border-radius:4px}
    .overlay-el.ribbon{background:linear-gradient(135deg,#6c5ce7,#a29bfe);padding:6px 20px;transform:rotate(-3deg)}
    .overlay-el.progress_bar{height:4px;background:rgba(255,255,255,.3);border-radius:2px;width:60%}
    .overlay-el.progress_bar::after{content:'';display:block;height:100%;background:#00d2d3;border-radius:2px;animation:progress-fill 5s linear forwards}
    .pos-top-left{top:12px;left:12px}.pos-top-right{top:12px;right:12px}.pos-bottom-left{bottom:12px;left:12px}.pos-bottom-right{bottom:12px;right:12px}.pos-center{top:50%;left:50%;transform:translate(-50%,-50%)}
    .tap-hint{position:absolute;bottom:20px;left:50%;transform:translateX(-50%);color:rgba(255,255,255,.6);font-size:11px;font-family:-apple-system,sans-serif;z-index:25;animation:fade-in 1s ease .5s forwards;opacity:0}
    @keyframes fade-in{from{opacity:0}to{opacity:1}}
    @keyframes slide-up{from{opacity:0;transform:translate(-50%,calc(-50% + 30px))}to{opacity:1;transform:translate(-50%,-50%)}}
    @keyframes slide-left{from{opacity:0;transform:translate(calc(-50% + 40px),-50%)}to{opacity:1;transform:translate(-50%,-50%)}}
    @keyframes slide-right{from{opacity:0;transform:translate(calc(-50% - 40px),-50%)}to{opacity:1;transform:translate(-50%,-50%)}}
    @keyframes zoom-in{from{opacity:0;transform:translate(-50%,-50%) scale(.5)}to{opacity:1;transform:translate(-50%,-50%) scale(1)}}
    @keyframes bounce-in{0%{opacity:0;transform:translate(-50%,-50%) scale(.3)}50%{transform:translate(-50%,-50%) scale(1.05)}70%{transform:translate(-50%,-50%) scale(.95)}100%{opacity:1;transform:translate(-50%,-50%) scale(1)}}
    @keyframes pulse-glow{0%,100%{box-shadow:0 0 20px rgba(255,107,107,.4)}50%{box-shadow:0 0 40px rgba(255,107,107,.8)}}
    @keyframes glow-pulse{0%,100%{box-shadow:0 0 20px rgba(249,202,36,.3)}50%{box-shadow:0 0 40px rgba(249,202,36,.7)}}
    @keyframes shake{0%,100%{transform:translate(-50%,-50%) rotate(0)}25%{transform:translate(-50%,-50%) rotate(-2deg)}75%{transform:translate(-50%,-50%) rotate(2deg)}}
    @keyframes progress-fill{from{width:0}to{width:100%}}
    .anim-fade-in{animation:fade-in .6s ease forwards}
    .anim-slide-up{animation:slide-up .6s ease forwards}
    .anim-slide-left{animation:slide-left .6s ease forwards}
    .anim-slide-right{animation:slide-right .6s ease forwards}
    .anim-zoom-in{animation:zoom-in .5s cubic-bezier(.175,.885,.32,1.275) forwards}
    .anim-bounce{animation:bounce-in .8s ease forwards}
    .anim-pulse{animation:fade-in .4s ease forwards,pulse-glow 2s ease-in-out .4s infinite}
    .anim-glow{animation:fade-in .4s ease forwards,glow-pulse 2s ease-in-out .4s infinite}
    .anim-shake{animation:fade-in .4s ease forwards,shake .5s ease-in-out .4s 3}
  </style>
</head>
<body>
  <div class="creative" id="creative">
    <video id="video" playsinline webkit-playsinline ${mutedAttr} ${loopAttr} preload="auto"${posterFrameUrl ? ` poster="${escapeHtml(posterFrameUrl)}"` : ''}>
      <source src="${escapeHtml(videoUrl)}" type="video/mp4">
    </video>
    <div class="poster-overlay" id="poster" style="${posterFrameUrl ? `background-image:url('${escapeHtml(posterFrameUrl)}')` : 'background:#111'}">
${posterCtas}
      <div class="tap-hint">Tap to play</div>
    </div>
    <div id="timeline-overlays" style="display:none">
${timelineCtas}
    </div>
  </div>
  <script>
(function(){
var v=document.getElementById('video'),p=document.getElementById('poster'),t=document.getElementById('timeline-overlays'),r=false,paused=false;
var o=t?Array.from(t.querySelectorAll('[data-show-at]')):[];
function doAction(el,e){
  var a=el.dataset.action;
  if(!a||a==='link')return;
  e.preventDefault();e.stopPropagation();
  if(a==='play'){if(paused){paused=false;v.play();}else{v.play();}}
  else if(a==='pause'){v.pause();paused=true;}
  else if(a==='replay'){v.currentTime=0;v.play();paused=false;}
  else if(a==='mute_toggle'){v.muted=!v.muted;}
  if(el.dataset.pause==='true'&&paused){paused=false;v.play();}
}
p.querySelectorAll('a.cta-btn').forEach(function(a){
  a.addEventListener('click',function(e){e.preventDefault();});
});
t.addEventListener('click',function(e){
  var btn=e.target.closest('[data-action]');
  if(btn)doAction(btn,e);
});
document.getElementById('creative').addEventListener('click',function(e){
  if(!r){
    e.preventDefault();r=true;p.classList.add('hidden');t.style.display='block';v.play();
    v.addEventListener('timeupdate',function(){
      var c=v.currentTime;
      o.forEach(function(el){
        var s=parseFloat(el.dataset.showAt),h=parseFloat(el.dataset.hideAt||'9999'),an=el.dataset.anim||'fade-in';
        if(c>=s&&c<h){
          if(!el.classList.contains('visible')){
            el.classList.add('visible','anim-'+an);el.style.opacity='';
            if(el.dataset.pause==='true'&&!paused){paused=true;v.pause();}
          }
        }else if(c>=h&&el.classList.contains('visible')){
          el.classList.remove('visible');el.style.opacity='0';
          el.className=el.className.replace(/anim-\\S+/g,'');
        }
      });
    });
  }else if(e.target.closest('.cta-btn')){
    var cb=e.target.closest('.cta-btn');
    var hr=cb.getAttribute('href');
    if(!hr||hr==='')e.preventDefault();
    if(paused){paused=false;v.play();}
    return;
  }else if(paused){
    paused=false;v.play();
  }
});
v.addEventListener('ended',function(){
  if(!v.loop){
    r=false;paused=false;p.classList.remove('hidden');t.style.display='none';
    o.forEach(function(el){el.classList.remove('visible');el.style.opacity='0';el.className=el.className.replace(/anim-\\S+/g,'');});
  }
});
})();
  </script>
</body>
</html>`;
}
