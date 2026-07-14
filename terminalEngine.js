class TerminalEngine {
    constructor(canvasId, config = {}) {
        this.canvas = document.getElementById(canvasId);
        if (!this.canvas) return;
        this.ctx = this.canvas.getContext('2d');

        // Scratch canvas for per-mask compositing
        this.offscreenCanvas = document.createElement('canvas');
        this.offCtx = this.offscreenCanvas.getContext('2d');

        // Static cached canvases — rebuilt only on resize, never during animation
        this.dimCanvas    = document.createElement('canvas');
        this.dimCtx       = this.dimCanvas.getContext('2d');
        this.brightCanvas = document.createElement('canvas');
        this.brightCtx    = this.brightCanvas.getContext('2d');

        this.fontSize    = config.fontSize    || 16;
        this.bgColor     = config.bgColor     || '#222222';
        this.dimColor    = config.dimColor    || '#2D2D2D';
        this.brightColor = config.brightColor || '#FFFFFF';

        this.masks    = [];
        this.navItems = [];
        this.navRow   = config.navRow !== undefined ? config.navRow : 2;
        this.hoveredNavIndex = -1;

        this.cols = 0;
        this.rows = 0;
        this.viewportCenter = { x: 0, y: 0 };

        this.sourceText = `void main() { vec2 uv = fragCoord.xy; if(mask.alpha > 0.5) { render_white(); } } template<typename T> class SystemMatrix { private: int bitmask; };`.replace(/\s+/g, ' ');

        this.initEvents();
        this.resize();
    }

    initEvents() {
        window.addEventListener('resize', () => this.resize());
        window.addEventListener('scroll', () => this.updateTracking(), { passive: true });
        this.updateTracking();
    }

    updateTracking() {
        this.viewportCenter.x = window.innerWidth  / 2;
        this.viewportCenter.y = window.innerHeight / 2;
    }

    resize() {
        const w = window.innerWidth, h = window.innerHeight;
        for (const c of [this.canvas, this.offscreenCanvas, this.dimCanvas, this.brightCanvas]) {
            c.width = w; c.height = h;
        }

        const font = `${this.fontSize}px 'Courier New', Courier, monospace`;
        this.fontSetup = font;
        for (const ctx of [this.ctx, this.offCtx, this.dimCtx, this.brightCtx]) {
            ctx.font = font;
            ctx.textBaseline = 'top';
        }

        this.charWidth = this.ctx.measureText('M').width;
        this.cols = Math.ceil(w / this.charWidth);
        this.rows = Math.ceil(h / this.fontSize);

        // Pre-render both grids — these are STATIC until next resize
        this._prerenderGrids();
    }

    _prerenderGrids() {
        // Dim grid
        this.dimCtx.clearRect(0, 0, this.dimCanvas.width, this.dimCanvas.height);
        this._drawTextGrid(this.dimCtx, this.dimColor);

        // Bright grid
        this.brightCtx.clearRect(0, 0, this.brightCanvas.width, this.brightCanvas.height);
        this._drawTextGrid(this.brightCtx, this.brightColor);
    }

    _drawTextGrid(ctx, color) {
        let idx = 0;
        ctx.fillStyle = color;
        for (let r = 0; r < this.rows; r++) {
            for (let c = 0; c < this.cols; c++) {
                ctx.fillText(this.sourceText[idx % this.sourceText.length], c * this.charWidth, r * this.fontSize);
                idx++;
            }
        }
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
            if (i === this.hoveredNavIndex) this.ctx.fillRect(r.x, uY, r.width, 1);
        });
    }

    addMask(options) {
        const img = new Image();
        img.src = options.src;
        const m = {
            img,
            x: options.x || 0,
            y: options.y || 0,
            docY: options.docY,
            width:  options.width  || 100,
            height: options.height || 100,
            proximityFade: options.proximityFade !== undefined ? options.proximityFade : true,
            maxDistance: options.maxDistance || 300,
            blinking: options.blinking || false,
            loaded: false
        };
        img.onload  = () => { m.loaded = true; };
        img.onerror = () => console.warn('mask failed:', options.src);
        this.masks.push(m);
    }

    renderFrame() {
        const scrollY = window.scrollY;
        const blinkOn = Math.floor(Date.now() / 530) % 2 === 0;

        // 1. Background color
        this.ctx.fillStyle = this.bgColor;
        this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

        // 2. Dim grid — GPU copy from pre-rendered static canvas (zero text drawing)
        this.ctx.drawImage(this.dimCanvas, 0, 0);

        // 3. Nav items
        this.drawNavItems();

        // 4. Each mask independently — bright grid copy + destination-in shape
        this.masks.filter(m => m.loaded).forEach(mask => {
            if (mask.docY !== undefined) mask.y = mask.docY - scrollY;
            if (mask.blinking && !blinkOn) return;

            let alpha = 1.0;
            if (mask.proximityFade) {
                const cx = mask.x + mask.width  / 2;
                const cy = mask.y + mask.height / 2;
                const dx = cx - this.viewportCenter.x;
                const dy = cy - this.viewportCenter.y;
                alpha = 1.0 - Math.min(Math.sqrt(dx*dx + dy*dy) / mask.maxDistance, 1.0);
            }
            if (alpha <= 0) return;

            // GPU copy of pre-rendered bright grid — no text drawing here
            this.offCtx.clearRect(0, 0, this.offscreenCanvas.width, this.offscreenCanvas.height);
            this.offCtx.drawImage(this.brightCanvas, 0, 0);

            this.offCtx.save();
            this.offCtx.globalCompositeOperation = 'destination-in';

            // Cut to mask shape
            this.offCtx.globalAlpha = alpha;
            this.offCtx.drawImage(mask.img, mask.x, mask.y, mask.width, mask.height);

            // Radial gradient edge fade
            this.offCtx.globalAlpha = 1;
            const cx = mask.x + mask.width  / 2;
            const cy = mask.y + mask.height / 2;
            const r  = Math.max(mask.width, mask.height) * 0.65;
            const grad = this.offCtx.createRadialGradient(cx, cy, r * 0.15, cx, cy, r);
            grad.addColorStop(0,    'rgba(0,0,0,1)');
            grad.addColorStop(0.5,  'rgba(0,0,0,0.9)');
            grad.addColorStop(0.75, 'rgba(0,0,0,0.4)');
            grad.addColorStop(1,    'rgba(0,0,0,0)');
            this.offCtx.fillStyle = grad;
            this.offCtx.fillRect(
                mask.x - mask.width  * 0.6, mask.y - mask.height * 0.6,
                mask.width * 2.2,           mask.height * 2.2
            );

            this.offCtx.restore();
            this.ctx.drawImage(this.offscreenCanvas, 0, 0);
        });
    }

    start() {
        const loop = () => { this.renderFrame(); requestAnimationFrame(loop); };
        requestAnimationFrame(loop);
    }
}
