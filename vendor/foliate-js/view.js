import * as CFI from './epubcfi.js'
import { TOCProgress, SectionProgress } from './progress.js'


// AnimeRead supplies parsed books through its ReaderEngine registry.

class CursorAutohider {
    #timeout
    #el
    #check
    #state
    constructor(el, check, state = {}) {
        this.#el = el
        this.#check = check
        this.#state = state
        if (this.#state.hidden) this.hide()
        this.#el.addEventListener('mousemove', ({ screenX, screenY }) => {
            // check if it actually moved
            if (screenX === this.#state.x && screenY === this.#state.y) return
            this.#state.x = screenX, this.#state.y = screenY
            this.show()
            if (this.#timeout) clearTimeout(this.#timeout)
            if (check()) this.#timeout = setTimeout(this.hide.bind(this), 1000)
        }, false)
    }
    cloneFor(el) {
        return new CursorAutohider(el, this.#check, this.#state)
    }
    hide() {
        this.#el.style.cursor = 'none'
        this.#state.hidden = true
    }
    show() {
        this.#el.style.removeProperty('cursor')
        this.#state.hidden = false
    }
}

class History extends EventTarget {
    #arr = []
    #index = -1
    pushState(x) {
        const last = this.#arr[this.#index]
        if (last === x || last?.fraction && last.fraction === x.fraction) return
        this.#arr[++this.#index] = x
        this.#arr.length = this.#index + 1
        this.dispatchEvent(new Event('index-change'))
    }
    replaceState(x) {
        const index = this.#index
        this.#arr[index] = x
    }
    back() {
        const index = this.#index
        if (index <= 0) return
        const detail = { state: this.#arr[index - 1] }
        this.#index = index - 1
        this.dispatchEvent(new CustomEvent('popstate', { detail }))
        this.dispatchEvent(new Event('index-change'))
    }
    forward() {
        const index = this.#index
        if (index >= this.#arr.length - 1) return
        const detail = { state: this.#arr[index + 1] }
        this.#index = index + 1
        this.dispatchEvent(new CustomEvent('popstate', { detail }))
        this.dispatchEvent(new Event('index-change'))
    }
    get canGoBack() {
        return this.#index > 0
    }
    get canGoForward() {
        return this.#index < this.#arr.length - 1
    }
    clear() {
        this.#arr = []
        this.#index = -1
    }
}

const languageInfo = lang => {
    if (!lang) return {}
    try {
        const canonical = Intl.getCanonicalLocales(lang)[0]
        const locale = new Intl.Locale(canonical)
        const isCJK = ['zh', 'ja', 'kr'].includes(locale.language)
        const direction = (locale.getTextInfo?.() ?? locale.textInfo)?.direction
        return { canonical, locale, isCJK, direction }
    } catch (e) {
        console.warn(e)
        return {}
    }
}

export class View extends HTMLElement {
    #root = this.attachShadow({ mode: 'closed' })
    #sectionProgress
    #tocProgress
    #pageProgress
    #cursorAutohider = new CursorAutohider(this, () =>
        this.hasAttribute('autohide-cursor'))
    isFixedLayout = false
    lastLocation
    history = new History()
    constructor() {
        super()
        this.history.addEventListener('popstate', ({ detail }) => {
            const resolved = this.resolveNavigation(detail.state)
            this.renderer.goTo(resolved)
        })
    }
    async open(book) {
        if (!Array.isArray(book?.sections)) throw new Error('Parsed book required')
        this.book = book
        this.language = languageInfo(book.metadata?.language)

        if (book.splitTOCHref && book.getTOCFragment) {
            const ids = book.sections.map(s => s.id)
            this.#sectionProgress = new SectionProgress(book.sections, 1500, 1600)
            const splitHref = book.splitTOCHref.bind(book)
            const getFragment = book.getTOCFragment.bind(book)
            this.#tocProgress = new TOCProgress()
            await this.#tocProgress.init({
                toc: book.toc ?? [], ids, splitHref, getFragment })
            this.#pageProgress = new TOCProgress()
            await this.#pageProgress.init({
                toc: book.pageList ?? [], ids, splitHref, getFragment })
        }

        this.isFixedLayout = this.book.rendition?.layout === 'pre-paginated'
        if (this.isFixedLayout) {
            await import('./fixed-layout.js')
            this.renderer = document.createElement('foliate-fxl')
        } else {
            await import('./paginator.js')
            this.renderer = document.createElement('foliate-paginator')
        }
        this.renderer.setAttribute('exportparts', 'head,foot,filter')
        this.renderer.addEventListener('load', e => this.#onLoad(e.detail))
        this.renderer.addEventListener('relocate', e => this.#onRelocate(e.detail))
        this.renderer.open(book)
        this.#root.append(this.renderer)

        if (book.sections.some(section => section.mediaOverlay)) {
            const activeClass = book.media.activeClass
            const playbackActiveClass = book.media.playbackActiveClass
            this.mediaOverlay = book.getMediaOverlay()
            let lastActive
            this.mediaOverlay.addEventListener('highlight', e => {
                const resolved = this.resolveNavigation(e.detail.text)
                this.renderer.goTo(resolved)
                    .then(() => {
                        const { doc } = this.renderer.getContents()
                            .find(x => x.index = resolved.index)
                        const el = resolved.anchor(doc)
                        el.classList.add(activeClass)
                        if (playbackActiveClass) el.ownerDocument
                            .documentElement.classList.add(playbackActiveClass)
                        lastActive = new WeakRef(el)
                    })
            })
            this.mediaOverlay.addEventListener('unhighlight', () => {
                const el = lastActive?.deref()
                if (el) {
                    el.classList.remove(activeClass)
                    if (playbackActiveClass) el.ownerDocument
                        .documentElement.classList.remove(playbackActiveClass)
                }
            })
        }
    }
    close() {
        this.renderer?.destroy()
        this.renderer?.remove()
        this.#sectionProgress = null
        this.#tocProgress = null
        this.#pageProgress = null
        this.lastLocation = null
        this.history.clear()
        this.mediaOverlay = null
    }
    goToTextStart() {
        return this.goTo(this.book.landmarks
            ?.find(m => m.type.includes('bodymatter') || m.type.includes('text'))
            ?.href ?? this.book.sections.findIndex(s => s.linear !== 'no'))
    }
    async init({ lastLocation, showTextStart }) {
        const resolved = lastLocation ? this.resolveNavigation(lastLocation) : null
        if (resolved) {
            await this.renderer.goTo(resolved)
            this.history.pushState(lastLocation)
        }
        else if (showTextStart) await this.goToTextStart()
        else {
            this.history.pushState(0)
            await this.next()
        }
    }
    #emit(name, detail, cancelable) {
        return this.dispatchEvent(new CustomEvent(name, { detail, cancelable }))
    }
    #onRelocate({ reason, range, index, fraction, size }) {
        const progress = this.#sectionProgress?.getProgress(index, fraction, size) ?? {}
        const tocItem = this.#tocProgress?.getProgress(index, range)
        const pageItem = this.#pageProgress?.getProgress(index, range)
        const cfi = this.getCFI(index, range)
        this.lastLocation = { ...progress, tocItem, pageItem, cfi, range }
        if (reason === 'snap' || reason === 'page' || reason === 'scroll')
            this.history.replaceState(cfi)
        this.#emit('relocate', this.lastLocation)
    }
    #onLoad({ doc, index }) {
        // set language and dir if not already set
        doc.documentElement.lang ||= this.language.canonical ?? ''
        if (!this.language.isCJK)
            doc.documentElement.dir ||= this.language.direction ?? ''

        this.#handleLinks(doc, index)
        this.#cursorAutohider.cloneFor(doc.documentElement)

        this.#emit('load', { doc, index })
    }
    #handleLinks(doc, index) {
        const { book } = this
        const section = book.sections[index]
        doc.addEventListener('click', e => {
            const a = e.target.closest('a[href]')
            if (!a) return
            e.preventDefault()
            const href_ = a.getAttribute('href')
            const href = section?.resolveHref?.(href_) ?? href_
            if (book?.isExternal?.(href))
                Promise.resolve(this.#emit('external-link', { a, href_ }, true))
                    .then(x => x ? globalThis.open(href_, '_blank') : null)
                    .catch(e => console.error(e))
            else Promise.resolve(this.#emit('link', { a, href }, true))
                .then(x => x ? this.goTo(href) : null)
                .catch(e => console.error(e))
        })
    }
    getCFI(index, range) {
        const baseCFI = this.book.sections[index].cfi ?? CFI.fake.fromIndex(index)
        if (!range) return baseCFI
        return CFI.joinIndir(baseCFI, CFI.fromRange(range))
    }
    resolveCFI(cfi) {
        if (this.book.resolveCFI)
            return this.book.resolveCFI(cfi)
        else {
            const parts = CFI.parse(cfi)
            const index = CFI.fake.toIndex((parts.parent ?? parts).shift())
            const anchor = doc => CFI.toRange(doc, parts)
            return { index, anchor }
        }
    }
    resolveNavigation(target) {
        try {
            if (typeof target === 'number') return { index: target }
            if (typeof target.fraction === 'number') {
                const [index, anchor] = this.#sectionProgress.getSection(target.fraction)
                return { index, anchor }
            }
            if (CFI.isCFI.test(target)) return this.resolveCFI(target)
            return this.book.resolveHref(target)
        } catch (e) {
            console.error(e)
            console.error(`Could not resolve target ${target}`)
        }
    }
    async goTo(target) {
        const resolved = this.resolveNavigation(target)
        try {
            await this.renderer.goTo(resolved)
            this.history.pushState(target)
            return resolved
        } catch(e) {
            console.error(e)
            console.error(`Could not go to ${target}`)
        }
    }
    async goToFraction(frac) {
        const [index, anchor] = this.#sectionProgress.getSection(frac)
        await this.renderer.goTo({ index, anchor })
        this.history.pushState({ fraction: frac })
    }
    async select(target) {
        try {
            const obj = await this.resolveNavigation(target)
            await this.renderer.goTo({ ...obj, select: true })
            this.history.pushState(target)
        } catch(e) {
            console.error(e)
            console.error(`Could not go to ${target}`)
        }
    }
    deselect() {
        for (const { doc } of this.renderer.getContents())
            doc.defaultView.getSelection().removeAllRanges()
    }
    getSectionFractions() {
        return (this.#sectionProgress?.sectionFractions ?? [])
            .map(x => x + Number.EPSILON)
    }
    getProgressOf(index, range) {
        const tocItem = this.#tocProgress?.getProgress(index, range)
        const pageItem = this.#pageProgress?.getProgress(index, range)
        return { tocItem, pageItem }
    }
    async getTOCItemOf(target) {
        try {
            const { index, anchor } = await this.resolveNavigation(target)
            const doc = await this.book.sections[index].createDocument()
            const frag = anchor(doc)
            const isRange = frag instanceof Range
            const range = isRange ? frag : doc.createRange()
            if (!isRange) range.selectNodeContents(frag)
            return this.#tocProgress.getProgress(index, range)
        } catch(e) {
            console.error(e)
            console.error(`Could not get ${target}`)
        }
    }
    async prev(distance) {
        await this.renderer.prev(distance)
    }
    async next(distance) {
        await this.renderer.next(distance)
    }
    goLeft() {
        return this.book.dir === 'rtl' ? this.next() : this.prev()
    }
    goRight() {
        return this.book.dir === 'rtl' ? this.prev() : this.next()
    }
    startMediaOverlay() {
        const { index } = this.renderer.getContents()[0]
        return this.mediaOverlay.start(index)
    }
}

customElements.define('foliate-view', View)
