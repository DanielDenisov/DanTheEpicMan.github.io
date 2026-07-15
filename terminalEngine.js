class TerminalEngine {
    constructor(canvasId, config = {}) {
        this.canvas = document.getElementById(canvasId);
        if (!this.canvas) return;
        this.ctx = this.canvas.getContext('2d');

        this.fontSize    = config.fontSize    || 16;
        this.bgColor     = config.bgColor     || '#222222';
        this.dimColor    = config.dimColor    || '#2D2D2D';
        this.brightColor = config.brightColor || '#FFFFFF';

        // Three pre-rendered canvases — all rebuilt on resize, never touched per-frame
        this.dimCanvas   = document.createElement('canvas'); // bg + dim text
        this.dimCtx      = this.dimCanvas.getContext('2d');
        this.brightCanvas   = document.createElement('canvas'); // transparent + bright text
        this.brightCtx      = this.brightCanvas.getContext('2d');

        // Two per-frame working canvases (cleared & reused each frame)
        this.maskAccumCanvas = document.createElement('canvas'); // accumulated mask shapes
        this.maskAccumCtx    = this.maskAccumCanvas.getContext('2d');
        this.revealCanvas    = document.createElement('canvas'); // bright text clipped to masks
        this.revealCtx       = this.revealCanvas.getContext('2d');

        this.masks    = [];
        this.navItems = [];
        this.navRow   = config.navRow !== undefined ? config.navRow : 2;
        this.hoveredNavIndex = -1;
        this.cols = 0; this.rows = 0;

        this.sourceText = '';

        window.addEventListener('resize', () => { if (this.sourceText) this.resize(); });

        const url = config.sourceTextUrl || 'source-text.txt';
        fetch(url)
            .then(r => r.text())
            .then(t => {
                this.sourceText = t.replace(/\s+/g, ' ').trim();
                this.resize();
            })
            .catch(() => {
                this.sourceText = 'void main() { vec2 uv = fragCoord.xy / iResolution.xy; }';
                this.resize();
            });
    }

    resize() {
        const w = window.innerWidth, h = window.innerHeight;
        [this.canvas, this.dimCanvas, this.brightCanvas,
         this.maskAccumCanvas, this.revealCanvas].forEach(c => {
            c.width = w; c.height = h;
        });

        const font = `${this.fontSize}px 'Courier New', Courier, monospace`;

        this.dimCtx.font = font; this.dimCtx.textBaseline = 'top';
        this.brightCtx.font = font; this.brightCtx.textBaseline = 'top';
        this.ctx.font = font; this.ctx.textBaseline = 'top';

        this.charWidth = this.dimCtx.measureText('M').width;
        this.cols = Math.ceil(w / this.charWidth);
        this.rows = Math.ceil(h / this.fontSize);

        // dim canvas: background fill + dim text — drawn ONCE here
        this.dimCtx.fillStyle = this.bgColor;
        this.dimCtx.fillRect(0, 0, w, h);
        this.dimCtx.fillStyle = this.dimColor;
        let idx = 0;
        for (let r = 0; r < this.rows; r++)
            for (let c = 0; c < this.cols; c++)
                this.dimCtx.fillText(this.sourceText[idx++ % this.sourceText.length], c * this.charWidth, r * this.fontSize);

        // bright canvas: transparent background + bright text — drawn ONCE here
        // (clearRect is implicit: new canvas is already transparent)
        this.brightCtx.fillStyle = this.brightColor;
        idx = 0;
        for (let r = 0; r < this.rows; r++)
            for (let c = 0; c < this.cols; c++)
                this.brightCtx.fillText(this.sourceText[idx++ % this.sourceText.length], c * this.charWidth, r * this.fontSize);

        // Re-bake any already-loaded masks at new viewport size (they keep their docY)
        this.masks.forEach(m => { if (m.loaded) this._bakeMaskCanvas(m); });
    }

    _bakeMaskCanvas(m) {
        const mc = document.createElement('canvas');
        mc.width  = Math.ceil(m.width);
        mc.height = Math.ceil(m.height);
        const mctx = mc.getContext('2d');

        // Letterbox to natural aspect ratio — consistent across Chrome/Firefox
        // (Chrome applies preserveAspectRatio="xMidYMid meet" natively; Firefox stretches.
        //  Doing it manually here makes both browsers identical.)
        const iw = m.img.naturalWidth  || mc.width;
        const ih = m.img.naturalHeight || mc.height;
        const scale = Math.min(mc.width / iw, mc.height / ih);
        const dw = iw * scale, dh = ih * scale;
        mctx.drawImage(m.img, (mc.width - dw) / 2, (mc.height - dh) / 2, dw, dh);

        // Bake radial gradient fade into the mask shape via destination-in
        const cx = mc.width  * 0.5;
        const cy = mc.height * 0.5;
        const radius = Math.sqrt(cx * cx + cy * cy) * 1.15;
        const grd = mctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
        grd.addColorStop(0.0, 'rgba(0,0,0,1)');
        grd.addColorStop(0.7, 'rgba(0,0,0,0.85)');
        grd.addColorStop(1.0, 'rgba(0,0,0,0)');
        mctx.globalCompositeOperation = 'destination-in';
        mctx.fillStyle = grd;
        mctx.fillRect(0, 0, mc.width, mc.height);

        m.maskCanvas = mc;
    }

    setNavItems(items) { this.navItems = items; }

    getNavItemRects() {
        const gap = 2;
        const total = this.navItems.reduce((s, it) => s + it.text.length, 0)
                    + gap * (this.navItems.length - 1);
        const startCol = Math.round((this.cols - total) / 2);
        const y = this.navRow * this.fontSize;
        let col = startCol;
        return this.navItems.map(it => {
            const r = { x: col * this.charWidth, y, width: it.text.length * this.charWidth, height: this.fontSize, href: it.href, text: it.text };
            col += it.text.length + gap;
            return r;
        });
    }

    drawNavItems() {
        if (!this.navItems.length) return;
        const rects = this.getNavItemRects();
        const uY = Math.round(this.navRow * this.fontSize + this.fontSize * 0.82);
        const first = rects[0], last = rects[rects.length - 1];
        this.ctx.fillStyle = this.bgColor;
        this.ctx.fillRect(first.x, first.y, (last.x + last.width) - first.x, this.fontSize);
        rects.forEach((r, i) => {
            this.ctx.fillStyle = this.brightColor;
            this.ctx.fillText(r.text, r.x, r.y);
            if (i === this.hoveredNavIndex) {
                this.ctx.fillRect(r.x, uY, r.width, 1);
            }
        });
    }

    addMask(options) {
        const m = {
            img: new Image(),
            x: options.x || 0,
            y: options.y || 0,
            docY: options.docY,
            width:    options.width    || 100,
            height:   options.height   || 100,
            blinking: options.blinking || false,
            loaded: false,
            maskCanvas: null
        };

        m.img.onload = () => {
            this._bakeMaskCanvas(m);
            m.loaded = true;
        };
        m.img.onerror = () => console.warn('Mask failed to load:', options.src);
        m.img.src = options.src;
        this.masks.push(m);
    }

    renderFrame() {
        const scrollY = window.scrollY;
        const blinkOn = Math.floor(Date.now() / 530) % 2 === 0;
        const w = this.canvas.width, h = this.canvas.height;

        // Update scroll-relative positions
        this.masks.forEach(m => { if (m.docY !== undefined) m.y = m.docY - scrollY; });

        // 1. Blit dim grid (single GPU copy — zero text draws per frame)
        this.ctx.drawImage(this.dimCanvas, 0, 0);

        const activeMasks = this.masks.filter(m => m.loaded && m.maskCanvas && (!m.blinking || blinkOn));

        if (activeMasks.length > 0) {
            // 2. Accumulate all mask shapes into maskAccumCanvas
            this.maskAccumCtx.clearRect(0, 0, w, h);
            this.maskAccumCtx.globalCompositeOperation = 'source-over';
            activeMasks.forEach(m => {
                this.maskAccumCtx.drawImage(m.maskCanvas, Math.round(m.x), Math.round(m.y));
            });

            // 3. Reveal bright text through combined mask (single destination-in pass)
            this.revealCtx.globalCompositeOperation = 'source-over';
            this.revealCtx.clearRect(0, 0, w, h);
            this.revealCtx.drawImage(this.brightCanvas, 0, 0);
            this.revealCtx.globalCompositeOperation = 'destination-in';
            this.revealCtx.drawImage(this.maskAccumCanvas, 0, 0);

            // 4. Blit revealed text onto main canvas
            this.ctx.globalCompositeOperation = 'source-over';
            this.ctx.drawImage(this.revealCanvas, 0, 0);
        }

        // 5. Nav items on top
        this.drawNavItems();
    }

    start() {
        const loop = () => { this.renderFrame(); requestAnimationFrame(loop); };
        requestAnimationFrame(loop);
    }
}
