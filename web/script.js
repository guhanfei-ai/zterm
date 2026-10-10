// 部署时可在页面前注入 window.ZTERM_MANIFEST_BASE；缺省时安全降级。
const manifestBase = typeof window.ZTERM_MANIFEST_BASE === 'string'
  ? window.ZTERM_MANIFEST_BASE.trim().replace(/\/$/, '')
  : '';
const MANIFEST_URLS = manifestBase ? {
  macos: `${manifestBase}/update-manifest-macos-arm64.json`,
  windows: `${manifestBase}/update-manifest-windows-x64.json`
} : { macos: '', windows: '' };

const OFFICIAL_RELEASE_URL = 'https://github.com/guhanfei-ai/zterm/releases/latest';

const COPY = {
  loading: '读取中',
  unavailable: '暂未就绪',
  unknownDate: '待发布',
  noSha: '—'
};

function setText(field, value) {
  const el = document.querySelector(`[data-field="${field}"]`);
  if (el) el.textContent = value;
}

function setHref(field, value) {
  const el = document.querySelector(`[data-field="${field}"]`);
  if (el instanceof HTMLAnchorElement) {
    el.href = value;
    el.removeAttribute('aria-disabled');
    el.classList.remove('is-disabled');
  }
}

function disableLink(field) {
  const el = document.querySelector(`[data-field="${field}"]`);
  if (el instanceof HTMLAnchorElement) {
    el.href = '#download';
    el.setAttribute('aria-disabled', 'true');
    el.classList.add('is-disabled');
  }
}

function setBadge(platform, value, accent = false) {
  const badge = document.querySelector(`[data-platform-badge="${platform}"]`);
  if (!badge) return;
  badge.textContent = value;
  badge.classList.toggle('chip-accent', accent);
}

function formatDate(raw) {
  if (!raw) return COPY.unknownDate;
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return raw;
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit'
  }).format(d);
}

function shortSha(sha256) {
  if (!sha256) return COPY.noSha;
  const s = String(sha256).trim();
  return s.length > 16 ? s.slice(0, 16) + '…' : s;
}

function applyManifest(platform, m) {
  setText(`${platform}-version`, m.version ? `v${m.version}` : COPY.unavailable);
  setText(`${platform}-date`, formatDate(m.published_at));
  setText(`${platform}-sha`, shortSha(m.sha256));
  // 下载按钮直接对接到 manifest.url 的真实安装包地址
  if (typeof m.url === 'string' && new URL(m.url).protocol === 'https:' && /^v?\d+\.\d+\.\d+$/.test(m.version) && /^[a-f0-9]{64}$/i.test(m.sha256)) {
    setHref(`${platform}-link`, m.url);
  } else {
    throw new Error('发布清单无效');
  }
  setHref(`${platform}-manifest`, MANIFEST_URLS[platform]);
  setBadge(platform, '最新版', true);
}

function applyUnavailable(platform) {
  setText(`${platform}-version`, '官方发布页');
  setText(`${platform}-date`, COPY.unknownDate);
  setText(`${platform}-sha`, COPY.noSha);
  setHref(`${platform}-link`, OFFICIAL_RELEASE_URL);
  setHref(`${platform}-manifest`, OFFICIAL_RELEASE_URL);
  const manifestLink = document.querySelector(`[data-field="${platform}-manifest"]`);
  if (manifestLink) manifestLink.textContent = '查看版本与安装包';
  setBadge(platform, '前往发布页选择安装包', false);
  const card = document.querySelector(`[data-platform-card="${platform}"]`);
  if (card) card.classList.remove('is-unavailable');
}

function detectPlatform() {
  const ua = navigator.userAgent.toLowerCase();
  if (ua.includes('mac os x')) return 'macos';
  if (ua.includes('windows')) return 'windows';
  return null;
}

function applyRecommendedPlatform() {
  const platform = detectPlatform();
  if (!platform) return;
  const card = document.querySelector(`[data-platform-card="${platform}"]`);
  if (card) card.classList.add('highlight');
  setBadge(platform, platform === 'macos' ? 'macOS · 请确认是 M 系列芯片' : 'Windows · 请选择 x64 安装包', true);
}

async function loadManifest(platform) {
  if (!MANIFEST_URLS[platform]) {
    applyUnavailable(platform);
    return false;
  }
  try {
    const res = await fetch(MANIFEST_URLS[platform], { cache: 'no-store', signal: AbortSignal.timeout(10_000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const m = await res.json();
    applyManifest(platform, m);
    return true;
  } catch (e) {
    console.warn(`[zTerm web] ${platform} manifest 加载失败`, e);
    applyUnavailable(platform);
    return false;
  }
}

// ---- 滚动渐入动画 ----
function setupScrollAnimations() {
  const fadeEls = document.querySelectorAll('.fade-in');
  if (!fadeEls.length) return;

  if (!('IntersectionObserver' in window)) {
    fadeEls.forEach(el => el.classList.add('visible'));
    return;
  }

  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('visible');
        observer.unobserve(entry.target);
      }
    });
  }, { threshold: 0.12, rootMargin: '0px 0px -40px 0px' });

  fadeEls.forEach(el => observer.observe(el));
}

// ---- 顶栏滚动增强 ----
function setupTopbarScroll() {
  const shell = document.getElementById('siteShell');
  if (!shell) return;
  let ticking = false;
  window.addEventListener('scroll', () => {
    if (!ticking) {
      requestAnimationFrame(() => {
        shell.classList.toggle('scrolled', window.scrollY > 20);
        ticking = false;
      });
      ticking = true;
    }
  }, { passive: true });
}

async function init() {
  applyRecommendedPlatform();
  setupScrollAnimations();
  setupTopbarScroll();
  await Promise.all(Object.keys(MANIFEST_URLS).map(loadManifest));
}

init();
