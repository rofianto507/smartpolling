/* ====================================================
   SMARTPOLLING — Mobile App (OWL, standalone)
   Struktur/UI-UX mengikuti pola strong_form.js (PetaDigi),
   diimplementasikan ulang memakai Owl (bukan IIFE polos).
   ==================================================== */
(function () {
    'use strict';

    const { Component, useState, useRef, onMounted, onWillUnmount, useEffect, mount, xml, markup } = owl;

    // ── RPC helper (JSON-RPC 2.0) ──────────────────────────────────────────
    async function rpc(url, params) {
        const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ jsonrpc: '2.0', method: 'call', id: Date.now(), params: params || {} }),
        });
        const json = await res.json();
        if (json.error) {
            const msg = (json.error.data && json.error.data.message) || json.error.message || 'Terjadi kesalahan';
            throw new Error(msg);
        }
        return json.result;
    }

    // ── Format helpers ──────────────────────────────────────────────────────
    function fmtDate(dtStr) {
        if (!dtStr) return '-';
        const d = new Date(dtStr.replace(' ', 'T') + 'Z');
        if (isNaN(d.getTime())) return dtStr;
        return d.toLocaleString('id-ID', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    }
    function parseUtc(dtStr) {
        if (!dtStr) return null;
        const d = new Date(dtStr.replace(' ', 'T') + 'Z');
        return isNaN(d.getTime()) ? null : d;
    }
    function fmtDateOnly(dtStr) {
        const d = parseUtc(dtStr);
        return d ? d.toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' }) : '-';
    }
    function fmtTime(d) {
        return d.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
    }
    // "Sab, 22 Nov 2026 · 09.00 – 12.00" (atau tanggal selesai lengkap kalau beda hari)
    function fmtAgendaWaktu(mulai, selesai) {
        const s = parseUtc(mulai);
        if (!s) return '-';
        const e = parseUtc(selesai);
        const tgl = s.toLocaleDateString('id-ID', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
        let out = `${tgl} · ${fmtTime(s)}`;
        if (e) {
            out += s.toDateString() === e.toDateString()
                ? ` – ${fmtTime(e)}`
                : ` – ${e.toLocaleDateString('id-ID', { day: 'numeric', month: 'short' })} ${fmtTime(e)}`;
        }
        return out;
    }

    const PILIHAN_LABELS = {
        memilih: 'Memilih', ragu_ragu: 'Ragu-ragu',
        belum_menentukan: 'Belum Menentukan', tidak_memilih: 'Tidak Memilih',
    };
    const STATE_LABELS = { baru: 'Baru', terverifikasi: 'Terverifikasi', ditolak: 'Ditolak' };
    const AGAMA_LABELS = {
        islam: 'Islam', kristen: 'Kristen', katolik: 'Katolik', hindu: 'Hindu',
        buddha: 'Buddha', konghucu: 'Konghucu', lainnya: 'Lainnya',
    };

    // ── Kompresi foto (canvas, target < ~700KB base64) ─────────────────────
    function compressImage(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = (e) => {
                const img = new Image();
                img.onload = () => {
                    let { width, height } = img;
                    const maxDim = 960;
                    if (width > maxDim || height > maxDim) {
                        if (width > height) { height = Math.round(height * maxDim / width); width = maxDim; }
                        else { width = Math.round(width * maxDim / height); height = maxDim; }
                    }
                    const canvas = document.createElement('canvas');
                    canvas.width = width; canvas.height = height;
                    canvas.getContext('2d').drawImage(img, 0, 0, width, height);
                    let quality = 0.75;
                    let dataUrl = canvas.toDataURL('image/jpeg', quality);
                    while (dataUrl.length > 700000 && quality > 0.35) {
                        quality -= 0.15;
                        dataUrl = canvas.toDataURL('image/jpeg', quality);
                    }
                    resolve(dataUrl);
                };
                img.onerror = () => reject(new Error('Gagal membaca gambar'));
                img.src = e.target.result;
            };
            reader.onerror = () => reject(new Error('Gagal membaca file'));
            reader.readAsDataURL(file);
        });
    }

    // ── Sub-template item (dipakai di Beranda & tab Info via t-call) ──────
    // xml`` memakai String.raw → nama template hasil xml() bisa disisipkan via ${...}.
    const BERITA_ITEM_TPL = xml/* xml */`
<div class="sm-news-item" t-on-click="() => this.openBeritaDetail(b.id)">
    <div class="sm-news-thumb">
        <t t-if="b.has_gambar"><img t-att-src="this.beritaImg(b.id, '200x200')" loading="lazy"/></t>
        <t t-else=""><i class="fa fa-newspaper-o"/></t>
    </div>
    <div class="sm-news-body">
        <div class="sm-news-title">
            <i t-if="b.is_pinned" class="fa fa-thumb-tack sm-news-pin"/>
            <t t-esc="b.judul"/>
        </div>
        <div class="sm-news-summary" t-if="b.ringkasan" t-esc="b.ringkasan"/>
        <div class="sm-news-date" t-esc="this.fmtDateOnly(b.tanggal)"/>
    </div>
</div>`;

    const AGENDA_ITEM_TPL = xml/* xml */`
<div t-attf-class="sm-list-item sm-agenda-item {{ a.state === 'batal' ? 'sm-agenda-item--batal' : '' }}" t-on-click="() => this.openAgendaDetail(a.id)">
    <div class="sm-agenda-date">
        <div class="sm-agenda-day" t-esc="this.agendaDay(a.mulai)"/>
        <div class="sm-agenda-mon" t-esc="this.agendaMon(a.mulai)"/>
    </div>
    <div class="sm-list-item-body">
        <div class="sm-list-name" t-esc="a.nama"/>
        <div class="sm-list-meta"><i class="fa fa-clock-o"/> <t t-esc="this.fmtAgendaWaktu(a.mulai, a.selesai)"/></div>
        <div class="sm-list-meta" t-if="a.lokasi"><i class="fa fa-map-marker"/> <t t-esc="a.lokasi"/></div>
    </div>
    <span t-if="a.state === 'batal'" class="sm-badge sm-badge--ditolak">Batal</span>
    <i t-else="" class="fa fa-chevron-right sm-list-arrow"/>
</div>`;

    // Bar perbandingan rencana vs realisasi (dipakai di Evaluasi Event).
    // Context: `rows` = [{label, value, text, cls}] dengan cls: plan | real | vote | over
    const CMP_TPL = xml/* xml */`
<div class="sm-cmp">
    <t t-foreach="rows" t-as="row" t-key="row_index">
        <div class="sm-cmp-row">
            <div class="sm-cmp-label"><span t-esc="row.label"/><b t-esc="row.text"/></div>
            <div class="sm-cmp-track">
                <div t-attf-class="sm-cmp-fill sm-cmp-fill--{{row.cls}}" t-attf-style="width:{{ this.cmpWidth(row, rows) }}%"/>
            </div>
        </div>
    </t>
</div>`;

    const EVENT_STATE_LABELS = {
        draft: 'Draft', diajukan: 'Menunggu Persetujuan', disetujui: 'Disetujui',
        ditolak: 'Ditolak', laporan: 'Laporan Dikirim', selesai: 'Selesai',
    };
    const RP = new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 });
    const NUM = new Intl.NumberFormat('id-ID', { maximumFractionDigits: 2 });
    const pad2 = (n) => String(n).padStart(2, '0');
    // UTC "YYYY-MM-DD HH:MM:SS" → nilai <input type="datetime-local"> (waktu lokal perangkat)
    function utcToLocalInput(dtStr) {
        const d = parseUtc(dtStr);
        if (!d) return '';
        return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
    }
    // nilai datetime-local (lokal) → UTC "YYYY-MM-DD HH:MM:SS" untuk server
    function localInputToUtc(value) {
        if (!value) return null;
        const d = new Date(value);
        return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 19).replace('T', ' ');
    }

    // ── App Component ────────────────────────────────────────────────────
    class App extends Component {
        static template = xml/* xml */`
<div t-attf-class="sm-shell {{ state.subpage ? 'sm-subpage' : '' }}">

    <!-- App Bar -->
    <div class="sm-appbar">
        <div class="sm-appbar-logo"><i class="fa fa-check-square-o"/></div>
        <div class="sm-appbar-content">
            <div class="sm-appbar-title">SmartPolling Mobile</div>
            <div class="sm-appbar-sub" t-esc="initData.relawan_name"/>
        </div>
        <div class="sm-appbar-actions">
            <button class="sm-appbar-btn" t-on-click="() => this.openInfo('berita')" title="Berita &amp; Agenda">
                <i class="fa fa-newspaper-o"/> Info
            </button>
        </div>
    </div>

    <!-- Sub-page topbar -->
    <t t-if="state.subpage">
        <div class="sm-form-topbar">
            <button class="sm-back-btn" t-on-click="closeSubpage"><i class="fa fa-arrow-left"/></button>
            <div class="sm-form-topbar-title" t-esc="this.subpageTitle"/>
        </div>
    </t>

    <!-- ══ TAB: BERANDA ══ -->
    <div t-attf-class="sm-tab {{ !state.subpage and state.tab === 'home' ? 'active' : '' }}">
        <div class="sm-page-body">
            <div class="sm-greeting">
                <div class="sm-greeting-avatar">
                    <t t-if="state.avatarSrc">
                        <img class="sm-greeting-av-img" t-att-src="state.avatarSrc"/>
                    </t>
                    <t t-else="">
                        <span class="sm-greeting-av-initials" t-esc="this.initials"/>
                    </t>
                </div>
                <div class="sm-greeting-text-wrap">
                    <div class="sm-greeting-text">Selamat datang,</div>
                    <div class="sm-greeting-name" t-esc="initData.relawan_name"/>
                </div>
            </div>

            <div class="sm-kpi-grid">
                <t t-foreach="this.kpiCards" t-as="c" t-key="c.key">
                    <div class="sm-kpi-card" t-attf-style="--kpi-color:{{c.color}};--kpi-bg:{{c.bg}}"
                         t-on-click="() => this.onKpiClick(c.key)">
                        <div class="sm-kpi-icon"><i t-attf-class="fa {{c.icon}}"/></div>
                        <div class="sm-kpi-text">
                            <div class="sm-kpi-value" t-esc="c.value"/>
                            <div class="sm-kpi-label" t-esc="c.label"/>
                        </div>
                    </div>
                </t>
            </div>

            <t t-if="state.kpi and state.kpi.event_perlu_laporan">
                <div class="sm-alert sm-alert--warning sm-alert--action" t-on-click="() => this.openEventTab('berjalan')">
                    <i class="fa fa-file-text-o sm-alert-icon"/>
                    <span><b t-esc="state.kpi.event_perlu_laporan"/> event sudah selesai dan menunggu berita acara. Ketuk untuk mengisi.</span>
                    <i class="fa fa-chevron-right"/>
                </div>
            </t>

            <div class="sm-chart-card">
                <div class="sm-chart-header"><i class="fa fa-bar-chart"/> Aktivitas Survey 7 Hari Terakhir</div>
                <div class="sm-chart-canvas" t-ref="weeklyChart"/>
            </div>

            <t t-if="state.infoHome and state.infoHome.agenda.length">
                <div class="sm-section-head">
                    <div class="sm-section-title"><i class="fa fa-calendar"/> Agenda Terdekat</div>
                    <button class="sm-link-btn" t-on-click="() => this.openInfo('agenda')">Lihat semua</button>
                </div>
                <div class="sm-list">
                    <t t-foreach="state.infoHome.agenda" t-as="a" t-key="a.id">
                        <t t-call="${AGENDA_ITEM_TPL}"/>
                    </t>
                </div>
            </t>

            <t t-if="state.infoHome and state.infoHome.berita.length">
                <div class="sm-section-head">
                    <div class="sm-section-title"><i class="fa fa-newspaper-o"/> Berita Terbaru</div>
                    <button class="sm-link-btn" t-on-click="() => this.openInfo('berita')">Lihat semua</button>
                </div>
                <div class="sm-list">
                    <t t-foreach="state.infoHome.berita" t-as="b" t-key="b.id">
                        <t t-call="${BERITA_ITEM_TPL}"/>
                    </t>
                </div>
            </t>

            <div class="sm-section-title"><i class="fa fa-clock-o"/> Aktivitas Survey Terbaru</div>
            <div class="sm-card">
                <t t-if="!state.kpi">
                    <div class="sm-loading-state"><i class="fa fa-spinner fa-spin"/><span>Memuat...</span></div>
                </t>
                <t t-elif="!state.kpi.recent.length">
                    <div class="sm-empty-state"><i class="fa fa-inbox"/>Belum ada aktivitas survey</div>
                </t>
                <t t-else="">
                    <t t-foreach="state.kpi.recent" t-as="r" t-key="r.id">
                        <div class="sm-activity-item">
                            <div class="sm-activity-icon"><i class="fa fa-comments"/></div>
                            <div class="sm-activity-body">
                                <div class="sm-activity-title" t-esc="r.dpt_name"/>
                                <div class="sm-activity-time" t-esc="this.fmtDate(r.tanggal)"/>
                            </div>
                            <span t-attf-class="sm-badge sm-badge--{{r.pilihan}}" t-esc="this.pilihanLabel(r.pilihan)"/>
                        </div>
                    </t>
                </t>
            </div>
        </div>
    </div>

    <!-- ══ TAB: DPT (list) ══ -->
    <div t-attf-class="sm-tab {{ !state.subpage and state.tab === 'dpt' ? 'active' : '' }}">
        <div class="sm-page-body">
            <div class="sm-search-wrap">
                <i class="fa fa-search"/>
                <input class="sm-search-input" placeholder="Cari nama atau NIK..."
                       t-model="state.dptSearch" t-on-keyup="onDptSearchKey"/>
            </div>
            <div class="sm-chip-row">
                <button t-attf-class="sm-chip {{ !state.dptStateFilter ? 'active' : '' }}" t-on-click="() => this.filterDptState(null)">Semua</button>
                <button t-attf-class="sm-chip {{ state.dptStateFilter === 'baru' ? 'active' : '' }}" t-on-click="() => this.filterDptState('baru')">Baru</button>
                <button t-attf-class="sm-chip {{ state.dptStateFilter === 'terverifikasi' ? 'active' : '' }}" t-on-click="() => this.filterDptState('terverifikasi')">Terverifikasi</button>
                <button t-attf-class="sm-chip {{ state.dptStateFilter === 'ditolak' ? 'active' : '' }}" t-on-click="() => this.filterDptState('ditolak')">Ditolak</button>
            </div>

            <t t-if="state.dptListLoading and !state.dptList.length">
                <div class="sm-loading-state"><i class="fa fa-spinner fa-spin"/><span>Memuat data DPT...</span></div>
            </t>
            <t t-elif="!state.dptList.length">
                <div class="sm-empty-state"><i class="fa fa-users"/>Belum ada data DPT</div>
            </t>
            <t t-else="">
                <div class="sm-list">
                    <t t-foreach="state.dptList" t-as="d" t-key="d.id">
                        <div class="sm-list-item" t-on-click="() => this.openDptDetail(d.id)">
                            <div class="sm-list-pin"><i class="fa fa-user"/></div>
                            <div class="sm-list-item-body">
                                <div class="sm-list-name" t-esc="d.nama"/>
                                <div class="sm-list-meta" t-esc="d.nik + ' · ' + d.tps_name"/>
                            </div>
                            <span t-attf-class="sm-badge sm-badge--{{d.state}}" t-esc="this.stateLabel(d.state)"/>
                        </div>
                    </t>
                </div>
                <t t-if="state.dptList.length &lt; state.dptTotal">
                    <div class="sm-list-footer">
                        <button class="sm-btn-secondary" t-on-click="loadMoreDpt" t-att-disabled="state.dptListLoading">
                            <t t-if="state.dptListLoading"><span class="sm-spinner"/></t>
                            <t t-else="">Muat Lebih Banyak (<t t-esc="state.dptList.length"/>/<t t-esc="state.dptTotal"/>)</t>
                        </button>
                    </div>
                </t>
            </t>
        </div>
        <button class="sm-fab sm-fab--show" t-on-click="openDptAdd"><i class="fa fa-plus"/></button>
    </div>

    <!-- ══ TAB: SURVEY (list) ══ -->
    <div t-attf-class="sm-tab {{ !state.subpage and state.tab === 'survey' ? 'active' : '' }}">
        <div class="sm-page-body">
            <t t-if="state.surveyListLoading and !state.surveyList.length">
                <div class="sm-loading-state"><i class="fa fa-spinner fa-spin"/><span>Memuat riwayat survey...</span></div>
            </t>
            <t t-elif="!state.surveyList.length">
                <div class="sm-empty-state"><i class="fa fa-comments"/>Belum ada survey tercatat</div>
            </t>
            <t t-else="">
                <div class="sm-list">
                    <t t-foreach="state.surveyList" t-as="s" t-key="s.id">
                        <div class="sm-list-item" t-on-click="() => this.openDptDetail(s.dpt_id)">
                            <div class="sm-list-pin"><i class="fa fa-comment"/></div>
                            <div class="sm-list-item-body">
                                <div class="sm-list-name" t-esc="s.dpt_name"/>
                                <div class="sm-list-meta" t-esc="this.fmtDate(s.tanggal)"/>
                            </div>
                            <span t-attf-class="sm-badge sm-badge--{{s.pilihan}}" t-esc="this.pilihanLabel(s.pilihan)"/>
                        </div>
                    </t>
                </div>
                <t t-if="state.surveyList.length &lt; state.surveyTotal">
                    <div class="sm-list-footer">
                        <button class="sm-btn-secondary" t-on-click="loadMoreSurvey" t-att-disabled="state.surveyListLoading">
                            <t t-if="state.surveyListLoading"><span class="sm-spinner"/></t>
                            <t t-else="">Muat Lebih Banyak (<t t-esc="state.surveyList.length"/>/<t t-esc="state.surveyTotal"/>)</t>
                        </button>
                    </div>
                </t>
            </t>
        </div>
        <button class="sm-fab sm-fab--show" t-on-click="() => this.openSurveyAddFor(null, '')"><i class="fa fa-plus"/></button>
    </div>

    <!-- ══ SUBPAGE: INFO (Berita & Agenda) — dibuka dari tombol Info / "Lihat semua" ══ -->
    <t t-if="state.subpage === 'info'">
        <div class="sm-page-body">
            <div class="sm-segment">
                <button t-attf-class="sm-segment-btn {{ state.infoTab === 'berita' ? 'active' : '' }}" t-on-click="() => this.switchInfoTab('berita')">
                    <i class="fa fa-newspaper-o"/> Berita
                </button>
                <button t-attf-class="sm-segment-btn {{ state.infoTab === 'agenda' ? 'active' : '' }}" t-on-click="() => this.switchInfoTab('agenda')">
                    <i class="fa fa-calendar"/> Agenda
                </button>
            </div>

            <!-- Berita -->
            <t t-if="state.infoTab === 'berita'">
                <div class="sm-search-wrap">
                    <i class="fa fa-search"/>
                    <input class="sm-search-input" placeholder="Cari judul berita..."
                           t-model="state.beritaSearch" t-on-keyup="onBeritaSearchKey"/>
                </div>
                <t t-if="state.beritaLoading and !state.beritaList.length">
                    <div class="sm-loading-state"><i class="fa fa-spinner fa-spin"/><span>Memuat berita...</span></div>
                </t>
                <t t-elif="!state.beritaList.length">
                    <div class="sm-empty-state"><i class="fa fa-newspaper-o"/>Belum ada berita</div>
                </t>
                <t t-else="">
                    <div class="sm-list">
                        <t t-foreach="state.beritaList" t-as="b" t-key="b.id">
                            <t t-call="${BERITA_ITEM_TPL}"/>
                        </t>
                    </div>
                    <t t-if="state.beritaList.length &lt; state.beritaTotal">
                        <div class="sm-list-footer">
                            <button class="sm-btn-secondary" t-on-click="() => this._loadBeritaList(false)" t-att-disabled="state.beritaLoading">
                                <t t-if="state.beritaLoading"><span class="sm-spinner"/></t>
                                <t t-else="">Muat Lebih Banyak (<t t-esc="state.beritaList.length"/>/<t t-esc="state.beritaTotal"/>)</t>
                            </button>
                        </div>
                    </t>
                </t>
            </t>

            <!-- Agenda -->
            <t t-if="state.infoTab === 'agenda'">
                <div class="sm-chip-row">
                    <button t-attf-class="sm-chip {{ state.agendaMode === 'upcoming' ? 'active' : '' }}" t-on-click="() => this.switchAgendaMode('upcoming')">Akan Datang</button>
                    <button t-attf-class="sm-chip {{ state.agendaMode === 'past' ? 'active' : '' }}" t-on-click="() => this.switchAgendaMode('past')">Sudah Lewat</button>
                </div>
                <t t-if="state.agendaLoading and !state.agendaList.length">
                    <div class="sm-loading-state"><i class="fa fa-spinner fa-spin"/><span>Memuat agenda...</span></div>
                </t>
                <t t-elif="!state.agendaList.length">
                    <div class="sm-empty-state"><i class="fa fa-calendar-o"/>
                        <t t-if="state.agendaMode === 'upcoming'">Tidak ada agenda mendatang</t>
                        <t t-else="">Belum ada agenda yang lewat</t>
                    </div>
                </t>
                <t t-else="">
                    <div class="sm-list">
                        <t t-foreach="state.agendaList" t-as="a" t-key="a.id">
                            <t t-call="${AGENDA_ITEM_TPL}"/>
                        </t>
                    </div>
                    <t t-if="state.agendaList.length &lt; state.agendaTotal">
                        <div class="sm-list-footer">
                            <button class="sm-btn-secondary" t-on-click="() => this._loadAgendaList(false)" t-att-disabled="state.agendaLoading">
                                <t t-if="state.agendaLoading"><span class="sm-spinner"/></t>
                                <t t-else="">Muat Lebih Banyak (<t t-esc="state.agendaList.length"/>/<t t-esc="state.agendaTotal"/>)</t>
                            </button>
                        </div>
                    </t>
                </t>
            </t>
        </div>
    </t>

    <!-- ══ TAB: EVENT ══ -->
    <div t-attf-class="sm-tab {{ !state.subpage and state.tab === 'event' ? 'active' : '' }}">
        <div class="sm-page-body">
            <div class="sm-chip-row">
                <t t-foreach="this.eventGroups" t-as="g" t-key="g.key">
                    <button t-attf-class="sm-chip {{ state.eventGroup === g.key ? 'active' : '' }}" t-on-click="() => this.filterEventGroup(g.key)" t-esc="g.label"/>
                </t>
            </div>
            <t t-if="state.eventLoading and !state.eventList.length">
                <div class="sm-loading-state"><i class="fa fa-spinner fa-spin"/><span>Memuat event...</span></div>
            </t>
            <t t-elif="!state.eventList.length">
                <div class="sm-empty-state"><i class="fa fa-flag-o"/>Belum ada event.<br/>Ketuk <b>+</b> untuk mengajukan event penggalangan suara.</div>
            </t>
            <t t-else="">
                <div class="sm-list">
                    <t t-foreach="state.eventList" t-as="e" t-key="e.id">
                        <div class="sm-list-item sm-event-item" t-on-click="() => this.openEventDetail(e.id)">
                            <div class="sm-agenda-date">
                                <div class="sm-agenda-day" t-esc="this.agendaDay(e.mulai)"/>
                                <div class="sm-agenda-mon" t-esc="this.agendaMon(e.mulai)"/>
                            </div>
                            <div class="sm-list-item-body">
                                <div class="sm-list-name" t-esc="e.nama"/>
                                <div class="sm-list-meta"><i class="fa fa-money"/> <t t-esc="this.fmtRp(e.dana_disetujui || e.total_anggaran)"/>
                                    · <i class="fa fa-bullseye"/> <t t-esc="e.realisasi_dpt"/>/<t t-esc="e.target_dpt"/> DPT</div>
                                <div class="sm-mini-progress"><div t-attf-style="width:{{ this.pct(e.realisasi_dpt, e.target_dpt) }}%"/></div>
                            </div>
                            <span t-attf-class="sm-badge sm-badge--ev-{{e.state}}" t-esc="this.eventStateLabel(e.state)"/>
                        </div>
                    </t>
                </div>
                <t t-if="state.eventList.length &lt; state.eventTotal">
                    <div class="sm-list-footer">
                        <button class="sm-btn-secondary" t-on-click="() => this._loadEventList(false)" t-att-disabled="state.eventLoading">
                            Muat Lebih Banyak (<t t-esc="state.eventList.length"/>/<t t-esc="state.eventTotal"/>)
                        </button>
                    </div>
                </t>
            </t>
        </div>
        <button class="sm-fab sm-fab--show" t-on-click="() => this.openEventForm(null)"><i class="fa fa-plus"/></button>
    </div>

    <!-- ══ TAB: PROFIL ══ -->
    <div t-attf-class="sm-tab {{ !state.subpage and state.tab === 'profil' ? 'active' : '' }}">
        <div class="sm-page-body">
            <div class="sm-card" style="text-align:center;">
                <div class="sm-greeting-avatar" style="width:72px;height:72px;margin:0 auto 12px;cursor:pointer;" t-on-click="triggerPhotoInput">
                    <t t-if="state.avatarSrc">
                        <img class="sm-greeting-av-img" t-att-src="state.avatarSrc"/>
                    </t>
                    <t t-else="">
                        <span class="sm-greeting-av-initials" style="font-size:22px;" t-esc="this.initials"/>
                    </t>
                </div>
                <div style="font-size:16px;font-weight:700;" t-esc="initData.relawan_name"/>
                <div style="font-size:12.5px;color:var(--sm-on-surf-var);margin-top:2px;" t-esc="initData.relawan_hp || 'Belum ada No. HP'"/>
                <button class="sm-btn-secondary" style="margin-top:12px;" t-on-click="triggerPhotoInput">
                    <i class="fa fa-camera"/> Ganti Foto Profil
                </button>
                <input type="file" accept="image/*" style="display:none;" t-ref="photoInput" t-on-change="onProfilPhotoChange"/>
            </div>

            <div class="sm-card">
                <div class="sm-card-title"><i class="fa fa-info-circle"/> Info Akun</div>
                <div class="sm-info-row">
                    <span class="sm-info-label">Nama Relawan</span>
                    <span class="sm-info-value" t-esc="initData.relawan_name"/>
                </div>
                <div class="sm-info-row">
                    <span class="sm-info-label">No. HP</span>
                    <span class="sm-info-value" t-esc="initData.relawan_hp || '-'"/>
                </div>
            </div>

            <button class="sm-btn-primary sm-btn-danger sm-btn-block" t-on-click="askLogout">
                <i class="fa fa-sign-out"/> Keluar
            </button>
        </div>
    </div>

    <!-- ══ SUBPAGE: DPT DETAIL ══ -->
    <t t-if="state.subpage === 'dpt-detail'">
        <div class="sm-page-body">
            <t t-if="state.dptDetailLoading or !state.dptDetail">
                <div class="sm-loading-state"><i class="fa fa-spinner fa-spin"/><span>Memuat detail...</span></div>
            </t>
            <t t-else="">
                <div class="sm-card">
                    <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:12px;">
                        <div style="font-size:17px;font-weight:700;" t-esc="state.dptDetail.nama"/>
                        <span t-attf-class="sm-badge sm-badge--{{state.dptDetail.state}}" t-esc="this.stateLabel(state.dptDetail.state)"/>
                    </div>
                    <div class="sm-info-row"><span class="sm-info-label">NIK</span><span class="sm-info-value" t-esc="state.dptDetail.nik"/></div>
                    <div class="sm-info-row"><span class="sm-info-label">Jenis Kelamin</span><span class="sm-info-value" t-esc="state.dptDetail.jenis_kelamin === 'L' ? 'Laki-laki' : 'Perempuan'"/></div>
                    <div class="sm-info-row"><span class="sm-info-label">No. HP</span><span class="sm-info-value" t-esc="state.dptDetail.hp || '-'"/></div>
                    <div class="sm-info-row"><span class="sm-info-label">Alamat</span><span class="sm-info-value" t-esc="state.dptDetail.alamat || '-'"/></div>
                    <div class="sm-info-row"><span class="sm-info-label">TPS</span><span class="sm-info-value" t-esc="state.dptDetail.tps_name"/></div>
                    <div class="sm-info-row"><span class="sm-info-label">Kecamatan</span><span class="sm-info-value" t-esc="state.dptDetail.kecamatan_name"/></div>
                    <div class="sm-info-row"><span class="sm-info-label">Kabupaten/Kota</span><span class="sm-info-value" t-esc="state.dptDetail.kabupaten_name"/></div>
                    <t t-if="state.dptDetail.pilihan_terakhir">
                        <div class="sm-info-row">
                            <span class="sm-info-label">Pilihan Terakhir</span>
                            <span t-attf-class="sm-badge sm-badge--{{state.dptDetail.pilihan_terakhir}}" t-esc="this.pilihanLabel(state.dptDetail.pilihan_terakhir)"/>
                        </div>
                    </t>
                </div>

                <div class="sm-card">
                    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;">
                        <div class="sm-card-title" style="margin-bottom:0;"><i class="fa fa-history"/> Riwayat Survey</div>
                        <button class="sm-btn-secondary" t-on-click="() => this.openSurveyAddFor(state.dptDetail.id, state.dptDetail.nama)">
                            <i class="fa fa-plus"/> Survey
                        </button>
                    </div>
                    <t t-if="!state.dptDetail.voters.length">
                        <div class="sm-empty-state" style="padding:20px 0;"><i class="fa fa-inbox"/>Belum ada survey</div>
                    </t>
                    <t t-else="">
                        <t t-foreach="state.dptDetail.voters" t-as="v" t-key="v_index">
                            <div class="sm-activity-item">
                                <div class="sm-activity-icon"><i class="fa fa-comment"/></div>
                                <div class="sm-activity-body">
                                    <div class="sm-activity-title" t-esc="this.fmtDate(v.tanggal)"/>
                                </div>
                                <span t-attf-class="sm-badge sm-badge--{{v.pilihan}}" t-esc="this.pilihanLabel(v.pilihan)"/>
                            </div>
                        </t>
                    </t>
                </div>
            </t>
        </div>
    </t>

    <!-- ══ SUBPAGE: DPT ADD ══ -->
    <t t-if="state.subpage === 'dpt-add'">
        <div class="sm-page-body">
            <div class="sm-card">
                <div class="sm-card-title"><i class="fa fa-id-card"/> Data Pemilih</div>

                <div class="sm-field">
                    <label class="sm-label">Nama <span class="sm-req">*</span></label>
                    <input class="sm-input" style="padding-left:14px;" t-model="state.dptForm.nama" placeholder="Nama lengkap"/>
                </div>
                <div class="sm-field">
                    <label class="sm-label">NIK <span class="sm-req">*</span></label>
                    <input class="sm-input" style="padding-left:14px;" t-model="state.dptForm.nik" placeholder="16 digit NIK" maxlength="16" inputmode="numeric"/>
                </div>
                <div class="sm-row-2">
                    <div class="sm-field">
                        <label class="sm-label">Jenis Kelamin <span class="sm-req">*</span></label>
                        <select class="sm-select" t-model="state.dptForm.jenis_kelamin">
                            <option value="">-- Pilih --</option>
                            <option value="L">Laki-laki</option>
                            <option value="P">Perempuan</option>
                        </select>
                    </div>
                    <div class="sm-field">
                        <label class="sm-label">TPS <span class="sm-req">*</span></label>
                        <select class="sm-select" t-model="state.dptForm.tps_id">
                            <option value="">-- Pilih TPS --</option>
                            <t t-foreach="state.tpsOptions" t-as="t_" t-key="t_.id">
                                <option t-att-value="t_.id" t-esc="t_.name"/>
                            </t>
                        </select>
                    </div>
                </div>
                <t t-if="!state.tpsOptions.length">
                    <div class="sm-alert sm-alert--warning">
                        <i class="fa fa-exclamation-circle sm-alert-icon"/>
                        <span>Anda belum mengoordinasi TPS aktif manapun. Hubungi admin untuk ditugaskan ke TPS.</span>
                    </div>
                </t>
                <div class="sm-field">
                    <label class="sm-label">No. HP</label>
                    <input class="sm-input" style="padding-left:14px;" t-model="state.dptForm.hp" placeholder="08xx-xxxx-xxxx"/>
                </div>
                <div class="sm-field">
                    <label class="sm-label">Alamat</label>
                    <textarea class="sm-textarea" t-model="state.dptForm.alamat" placeholder="Alamat lengkap"/>
                </div>
                <div class="sm-row-2">
                    <div class="sm-field">
                        <label class="sm-label">Agama</label>
                        <select class="sm-select" t-model="state.dptForm.agama">
                            <option value="">-- Pilih --</option>
                            <option value="islam">Islam</option>
                            <option value="kristen">Kristen</option>
                            <option value="katolik">Katolik</option>
                            <option value="hindu">Hindu</option>
                            <option value="buddha">Buddha</option>
                            <option value="konghucu">Konghucu</option>
                            <option value="lainnya">Lainnya</option>
                        </select>
                    </div>
                    <div class="sm-field">
                        <label class="sm-label">Pekerjaan</label>
                        <input class="sm-input" style="padding-left:14px;" t-model="state.dptForm.pekerjaan"/>
                    </div>
                </div>
                <div class="sm-row-2">
                    <div class="sm-field">
                        <label class="sm-label">Tempat Lahir</label>
                        <input class="sm-input" style="padding-left:14px;" t-model="state.dptForm.tempat_lahir"/>
                    </div>
                    <div class="sm-field">
                        <label class="sm-label">Tanggal Lahir</label>
                        <input class="sm-input" style="padding-left:14px;" type="date" t-model="state.dptForm.tanggal_lahir"/>
                    </div>
                </div>
            </div>

            <div class="sm-card">
                <div class="sm-card-title"><i class="fa fa-crosshairs"/> Koordinat GPS</div>
                <div class="sm-gps-row">
                    <div style="flex:1;">
                        <label class="sm-label">Posisi <span class="sm-req">*</span></label>
                        <div class="sm-gps-status">
                            <t t-if="state.dptForm.latitude">
                                <i class="fa fa-check-circle" style="color:var(--sm-success);margin-right:5px;"/>
                                <t t-esc="state.dptForm.latitude"/>, <t t-esc="state.dptForm.longitude"/>
                                <span t-if="state.gpsAccuracy" style="opacity:.6;font-size:11px;">
                                    (±<t t-esc="Math.round(state.gpsAccuracy)"/>m)
                                </span>
                            </t>
                            <t t-else="">
                                <i class="fa fa-circle-o" style="margin-right:5px;opacity:.4;"/>Belum diambil
                            </t>
                        </div>
                    </div>
                    <button class="sm-gps-btn" style="margin-top:20px;" t-on-click="requestGps" t-att-disabled="state.gpsLoading">
                        <t t-if="state.gpsLoading"><span class="sm-spinner" style="border-top-color:var(--sm-primary);border-color:rgba(113,75,103,0.3);"/></t>
                        <t t-else=""><i class="fa fa-crosshairs"/></t>
                        <t t-if="state.dptForm.latitude"> Perbarui</t>
                        <t t-else=""> Ambil GPS</t>
                    </button>
                </div>
                <div class="sm-gps-map" t-ref="gpsMap">
                    <div class="sm-gps-map-hint">Geser marker untuk menyesuaikan titik</div>
                </div>
                <div class="sm-row-2" style="margin-top:12px;">
                    <div class="sm-field" style="margin-bottom:0;">
                        <label class="sm-label">Latitude</label>
                        <input type="text" class="sm-input" style="padding-left:14px;" t-att-value="state.dptForm.latitude || ''" placeholder="0.000000" readonly="readonly"/>
                    </div>
                    <div class="sm-field" style="margin-bottom:0;">
                        <label class="sm-label">Longitude</label>
                        <input type="text" class="sm-input" style="padding-left:14px;" t-att-value="state.dptForm.longitude || ''" placeholder="0.000000" readonly="readonly"/>
                    </div>
                </div>
            </div>

            <div class="sm-submit-bar">
                <button class="sm-btn-primary sm-btn-block" t-on-click="submitDpt" t-att-disabled="state.submitting">
                    <t t-if="state.submitting"><span class="sm-spinner"/><span>Menyimpan...</span></t>
                    <t t-else=""><i class="fa fa-save"/><span>Simpan Data DPT</span></t>
                </button>
            </div>
        </div>
    </t>

    <!-- ══ SUBPAGE: SURVEY ADD ══ -->
    <t t-if="state.subpage === 'survey-add'">
        <div class="sm-page-body">
            <t t-if="!state.surveyForm.dpt_id">
                <div class="sm-search-wrap">
                    <i class="fa fa-search"/>
                    <input class="sm-search-input" placeholder="Cari nama atau NIK DPT..."
                           t-model="state.dptPickSearch" t-on-keyup="onDptPickSearchKey"/>
                </div>
                <t t-if="state.dptPickLoading">
                    <div class="sm-loading-state"><i class="fa fa-spinner fa-spin"/><span>Mencari...</span></div>
                </t>
                <t t-elif="!state.dptPickResults.length">
                    <div class="sm-empty-state"><i class="fa fa-search"/>Ketik nama/NIK untuk mencari DPT</div>
                </t>
                <t t-else="">
                    <div class="sm-list">
                        <t t-foreach="state.dptPickResults" t-as="d" t-key="d.id">
                            <div class="sm-list-item" t-on-click="() => this.pickDptForSurvey(d.id, d.nama)">
                                <div class="sm-list-pin"><i class="fa fa-user"/></div>
                                <div class="sm-list-item-body">
                                    <div class="sm-list-name" t-esc="d.nama"/>
                                    <div class="sm-list-meta" t-esc="d.nik + ' · ' + d.tps_name"/>
                                </div>
                                <i class="fa fa-chevron-right sm-list-arrow"/>
                            </div>
                        </t>
                    </div>
                </t>
            </t>
            <t t-else="">
                <div class="sm-card">
                    <div class="sm-card-title"><i class="fa fa-user"/> DPT Terpilih</div>
                    <div style="font-size:15px;font-weight:700;" t-esc="state.surveyForm.dpt_name"/>
                    <button class="sm-btn-secondary" style="margin-top:8px;" t-on-click="() => state.surveyForm.dpt_id = null">
                        <i class="fa fa-exchange"/> Ganti DPT
                    </button>
                </div>

                <div class="sm-card">
                    <div class="sm-card-title"><i class="fa fa-check-square-o"/> Preferensi Pilihan <span class="sm-req">*</span></div>
                    <select class="sm-select" t-model="state.surveyForm.pilihan">
                        <option value="">-- Pilih --</option>
                        <option value="memilih">Memilih</option>
                        <option value="ragu_ragu">Ragu-ragu</option>
                        <option value="belum_menentukan">Belum Menentukan</option>
                        <option value="tidak_memilih">Tidak Memilih</option>
                    </select>
                </div>

                <t t-if="state.activeEvents.length">
                    <div class="sm-card">
                        <div class="sm-card-title"><i class="fa fa-flag"/> Bagian dari Event</div>
                        <select class="sm-select" t-model="state.surveyForm.event_id">
                            <option value="" t-att-selected="!state.surveyForm.event_id">-- Bukan survey event --</option>
                            <!-- t-att-selected eksplisit: opsi dimuat async setelah t-model memasang nilai,
                                 tanpa ini dropdown menampilkan "Bukan survey event" padahal event terpilih -->
                            <t t-foreach="state.activeEvents" t-as="ev" t-key="ev.id">
                                <option t-att-value="ev.id" t-att-selected="this.isSurveyEvent(ev.id)" t-esc="ev.nama"/>
                            </t>
                        </select>
                        <div class="sm-hint">Survey yang ditandai dihitung sebagai realisasi target event.</div>
                    </div>
                </t>

                <div class="sm-card">
                    <div class="sm-card-title"><i class="fa fa-camera"/> Foto Dokumentasi (opsional)</div>
                    <t t-if="state.surveyForm.fotoPreview">
                        <div class="sm-foto-preview"><img t-att-src="state.surveyForm.fotoPreview"/></div>
                        <button class="sm-btn-secondary sm-btn-danger" style="margin-top:8px;" t-on-click="clearSurveyFoto">
                            <i class="fa fa-trash"/> Hapus Foto
                        </button>
                    </t>
                    <t t-else="">
                        <div class="sm-foto-zone" t-on-click="triggerSurveyFotoInput">
                            <i class="fa fa-camera"/>
                            <div class="sm-foto-zone-text">Ketuk untuk ambil/pilih foto</div>
                            <div class="sm-foto-zone-sub">JPEG/PNG, otomatis dikompres</div>
                        </div>
                    </t>
                    <input type="file" accept="image/*" capture="environment" style="display:none;" t-ref="surveyFotoInput" t-on-change="onSurveyFotoChange"/>
                </div>

                <div class="sm-submit-bar">
                    <button class="sm-btn-primary sm-btn-block" t-on-click="submitSurvey" t-att-disabled="state.submitting">
                        <t t-if="state.submitting"><span class="sm-spinner"/><span>Menyimpan...</span></t>
                        <t t-else=""><i class="fa fa-save"/><span>Simpan Survey</span></t>
                    </button>
                </div>
            </t>
        </div>
    </t>

    <!-- ══ SUBPAGE: BERITA DETAIL ══ -->
    <t t-if="state.subpage === 'berita-detail'">
        <div class="sm-page-body">
            <t t-if="!state.beritaDetail">
                <div class="sm-loading-state"><i class="fa fa-spinner fa-spin"/><span>Memuat berita...</span></div>
            </t>
            <t t-else="">
                <div class="sm-card sm-article">
                    <t t-if="state.beritaDetail.has_gambar">
                        <img class="sm-article-hero" t-att-src="this.beritaImg(state.beritaDetail.id, '960x0')"/>
                    </t>
                    <h1 class="sm-article-title" t-esc="state.beritaDetail.judul"/>
                    <div class="sm-article-meta">
                        <i class="fa fa-clock-o"/> <t t-esc="this.fmtDateOnly(state.beritaDetail.tanggal)"/>
                        <t t-if="state.beritaDetail.penulis"> · <t t-esc="state.beritaDetail.penulis"/></t>
                    </div>
                    <div class="sm-rich" t-out="this.html(state.beritaDetail.isi)"/>
                </div>
            </t>
        </div>
    </t>

    <!-- ══ SUBPAGE: AGENDA DETAIL ══ -->
    <t t-if="state.subpage === 'agenda-detail'">
        <div class="sm-page-body">
            <t t-if="!state.agendaDetail">
                <div class="sm-loading-state"><i class="fa fa-spinner fa-spin"/><span>Memuat agenda...</span></div>
            </t>
            <t t-else="">
                <div class="sm-card">
                    <t t-if="state.agendaDetail.state === 'batal'">
                        <div class="sm-alert sm-alert--error">
                            <i class="fa fa-ban sm-alert-icon"/><span>Agenda ini <b>dibatalkan</b>.</span>
                        </div>
                    </t>
                    <div class="sm-article-title" t-esc="state.agendaDetail.nama"/>
                    <div class="sm-info-row">
                        <span class="sm-info-label"><i class="fa fa-clock-o"/> Waktu</span>
                        <span class="sm-info-value" t-esc="this.fmtAgendaWaktu(state.agendaDetail.mulai, state.agendaDetail.selesai)"/>
                    </div>
                    <div class="sm-info-row">
                        <span class="sm-info-label"><i class="fa fa-map-marker"/> Lokasi</span>
                        <span class="sm-info-value" t-esc="state.agendaDetail.lokasi || '-'"/>
                    </div>
                </div>
                <t t-if="state.agendaDetail.deskripsi">
                    <div class="sm-card">
                        <div class="sm-card-title"><i class="fa fa-align-left"/> Deskripsi</div>
                        <div class="sm-rich" t-out="this.html(state.agendaDetail.deskripsi)"/>
                    </div>
                </t>
            </t>
        </div>
    </t>

    <!-- ══ SUBPAGE: EVENT DETAIL ══ -->
    <t t-if="state.subpage === 'event-detail'">
        <div class="sm-page-body">
            <t t-if="!state.eventDetail">
                <div class="sm-loading-state"><i class="fa fa-spinner fa-spin"/><span>Memuat event...</span></div>
            </t>
            <t t-else="">
                <t t-set="ev" t-value="state.eventDetail"/>
                <div class="sm-card">
                    <div class="sm-ev-head">
                        <div class="sm-ev-code" t-esc="ev.code"/>
                        <span t-attf-class="sm-badge sm-badge--ev-{{ev.state}}" t-esc="this.eventStateLabel(ev.state)"/>
                    </div>
                    <div class="sm-article-title" t-esc="ev.nama"/>
                    <div class="sm-info-row"><span class="sm-info-label"><i class="fa fa-clock-o"/> Waktu</span><span class="sm-info-value" t-esc="this.fmtAgendaWaktu(ev.mulai, ev.selesai)"/></div>
                    <div class="sm-info-row"><span class="sm-info-label"><i class="fa fa-map-marker"/> Lokasi</span><span class="sm-info-value" t-esc="ev.lokasi || '-'"/></div>
                    <div class="sm-info-row"><span class="sm-info-label"><i class="fa fa-bullseye"/> Target DPT</span><span class="sm-info-value"><t t-esc="ev.target_dpt"/> DPT tersurvey</span></div>
                    <t t-if="ev.deskripsi"><div class="sm-ev-desc" t-esc="ev.deskripsi"/></t>
                </div>

                <div t-attf-class="sm-alert sm-alert--{{ this.eventHint(ev).type }}">
                    <i t-attf-class="fa {{ this.eventHint(ev).icon }} sm-alert-icon"/>
                    <span t-esc="this.eventHint(ev).text"/>
                </div>
                <t t-if="ev.catatan_admin and ['draft', 'ditolak', 'disetujui'].includes(ev.state)">
                    <div class="sm-alert sm-alert--error">
                        <i class="fa fa-commenting sm-alert-icon"/>
                        <span><b>Catatan admin pusat:</b><br/><t t-esc="ev.catatan_admin"/></span>
                    </div>
                </t>

                <!-- Evaluasi: tampil setelah berita acara dikirim -->
                <t t-if="['laporan', 'selesai'].includes(ev.state)">
                    <div class="sm-card">
                        <div class="sm-card-title"><i class="fa fa-balance-scale"/> Evaluasi Dana</div>
                        <t t-call="${CMP_TPL}">
                            <t t-set="rows" t-value="[
                                {label: 'Dana disetujui', value: ev.dana_disetujui, text: this.fmtRp(ev.dana_disetujui), cls: 'plan'},
                                {label: 'Realisasi dana', value: ev.total_realisasi, text: this.fmtRp(ev.total_realisasi), cls: ev.selisih_dana &lt; 0 ? 'over' : 'real'},
                            ]"/>
                        </t>
                        <div class="sm-ev-stats">
                            <div><span>Serapan</span><b t-esc="ev.persen_serapan + '%'"/></div>
                            <div><span t-esc="ev.selisih_dana &lt; 0 ? 'Lebih bayar' : 'Sisa dana'"/>
                                <b t-attf-class="{{ ev.selisih_dana &lt; 0 ? 'sm-neg' : 'sm-pos' }}" t-esc="this.fmtRp(Math.abs(ev.selisih_dana))"/></div>
                        </div>
                    </div>
                    <div class="sm-card">
                        <div class="sm-card-title"><i class="fa fa-bullseye"/> Evaluasi Target Suara</div>
                        <t t-call="${CMP_TPL}">
                            <t t-set="rows" t-value="[
                                {label: 'Target DPT', value: ev.target_dpt, text: ev.target_dpt + ' DPT', cls: 'plan'},
                                {label: 'DPT tersurvey', value: ev.realisasi_dpt, text: ev.realisasi_dpt + ' DPT', cls: 'real'},
                                {label: 'Suara Memilih', value: ev.realisasi_memilih, text: ev.realisasi_memilih + ' suara', cls: 'vote'},
                            ]"/>
                        </t>
                        <div class="sm-ev-stats">
                            <div><span>Capaian target</span><b t-esc="ev.persen_target + '%'"/></div>
                            <div><span>Memilih</span><b t-esc="ev.persen_memilih + '%'"/></div>
                            <div><span>Biaya / suara</span><b t-esc="ev.realisasi_memilih ? this.fmtRp(ev.biaya_per_suara) : '-'"/></div>
                        </div>
                    </div>
                </t>
                <!-- Progres survey selama event berjalan -->
                <t t-elif="ev.state === 'disetujui'">
                    <div class="sm-card">
                        <div class="sm-card-title"><i class="fa fa-line-chart"/> Progres Target</div>
                        <div class="sm-ev-progress-label"><b t-esc="ev.realisasi_dpt"/> dari <t t-esc="ev.target_dpt"/> DPT tersurvey (<t t-esc="ev.realisasi_memilih"/> memilih)</div>
                        <div class="sm-mini-progress sm-mini-progress--lg"><div t-attf-style="width:{{ this.pct(ev.realisasi_dpt, ev.target_dpt) }}%"/></div>
                    </div>
                </t>

                <div class="sm-card">
                    <div class="sm-card-title"><i class="fa fa-calculator"/> Rincian Anggaran</div>
                    <t t-foreach="ev.anggaran" t-as="a" t-key="a_index">
                        <div class="sm-line-row">
                            <div class="sm-line-main">
                                <div class="sm-line-title" t-esc="a.uraian"/>
                                <div class="sm-line-sub"><t t-esc="this.fmtNum(a.qty)"/> <t t-esc="a.satuan"/> × <t t-esc="this.fmtRp(a.harga_satuan)"/></div>
                            </div>
                            <div class="sm-line-amount" t-esc="this.fmtRp(a.subtotal)"/>
                        </div>
                    </t>
                    <div class="sm-line-total"><span>Total diajukan</span><b t-esc="this.fmtRp(ev.total_anggaran)"/></div>
                    <t t-if="ev.dana_disetujui">
                        <div class="sm-line-total sm-line-total--ok"><span>Dana disetujui</span><b t-esc="this.fmtRp(ev.dana_disetujui)"/></div>
                    </t>
                </div>

                <t t-if="ev.ba_tanggal">
                    <div class="sm-card">
                        <div class="sm-card-title"><i class="fa fa-file-text-o"/> Berita Acara</div>
                        <t t-if="ev.has_foto_kegiatan">
                            <img class="sm-ba-foto" t-att-src="'/web/image/smartpolling.event/' + ev.id + '/ba_foto_kegiatan/800x0?u=' + ev.ba_tanggal"/>
                        </t>
                        <div class="sm-info-row"><span class="sm-info-label">Dikirim</span><span class="sm-info-value" t-esc="this.fmtDate(ev.ba_tanggal)"/></div>
                        <div class="sm-info-row"><span class="sm-info-label">Peserta hadir</span><span class="sm-info-value"><t t-esc="ev.ba_jumlah_peserta"/> orang</span></div>
                        <div class="sm-ev-desc" t-esc="ev.ba_ringkasan"/>
                        <div class="sm-card-subtitle">Rincian penggunaan dana</div>
                        <t t-foreach="ev.realisasi" t-as="r" t-key="r.id">
                            <div class="sm-line-row">
                                <t t-if="r.has_bukti">
                                    <img class="sm-line-thumb" t-att-src="'/web/image/smartpolling.event.realisasi/' + r.id + '/bukti/120x120?u=' + ev.ba_tanggal"/>
                                </t>
                                <div class="sm-line-main"><div class="sm-line-title" t-esc="r.uraian"/></div>
                                <div class="sm-line-amount" t-esc="this.fmtRp(r.jumlah)"/>
                            </div>
                        </t>
                        <div class="sm-line-total"><span>Total realisasi</span><b t-esc="this.fmtRp(ev.total_realisasi)"/></div>
                    </div>
                </t>

                <div class="sm-submit-bar sm-action-bar">
                    <t t-if="ev.can_edit">
                        <button class="sm-btn-secondary sm-btn-danger" t-on-click="() => this.askConfirm('Hapus draft event ini?', () => this.deleteEvent(ev.id))"><i class="fa fa-trash"/></button>
                        <button class="sm-btn-secondary" t-on-click="() => this.openEventForm(ev)"><i class="fa fa-pencil"/> Edit</button>
                        <button class="sm-btn-primary" t-on-click="() => this.askConfirm('Ajukan event ini ke admin pusat untuk pendanaan? Setelah diajukan, data tidak bisa diubah.', () => this.ajukanEvent(ev.id))">
                            <i class="fa fa-paper-plane"/> Ajukan
                        </button>
                    </t>
                    <t t-if="ev.can_survey">
                        <button class="sm-btn-secondary" t-on-click="() => this.openSurveyAddFor(null, '', ev.id)"><i class="fa fa-plus"/> Survey</button>
                    </t>
                    <t t-if="ev.can_lapor">
                        <button class="sm-btn-primary" t-on-click="openBaForm"><i class="fa fa-file-text-o"/> <t t-esc="ev.realisasi.length ? 'Perbaiki Berita Acara' : 'Isi Berita Acara'"/></button>
                    </t>
                </div>
            </t>
        </div>
    </t>

    <!-- ══ SUBPAGE: EVENT FORM (buat / edit draft) ══ -->
    <t t-if="state.subpage === 'event-form'">
        <div class="sm-page-body">
            <t t-set="f" t-value="state.eventForm"/>
            <div class="sm-card">
                <div class="sm-card-title"><i class="fa fa-flag"/> Detail Event</div>
                <div class="sm-field">
                    <label class="sm-label">Nama Event <span class="sm-req">*</span></label>
                    <input class="sm-input sm-input--plain" t-model="f.nama" placeholder="mis. Silaturahmi Warga RW 05"/>
                </div>
                <!-- Ditumpuk (bukan 2 kolom): datetime-local punya lebar minimum bawaan yang meluber di layar HP -->
                <div class="sm-field">
                    <label class="sm-label">Mulai <span class="sm-req">*</span></label>
                    <input class="sm-input sm-input--plain" type="datetime-local" t-model="f.mulai"/>
                </div>
                <div class="sm-field">
                    <label class="sm-label">Selesai <span class="sm-req">*</span></label>
                    <input class="sm-input sm-input--plain" type="datetime-local" t-model="f.selesai"/>
                </div>
                <div class="sm-field">
                    <label class="sm-label">Lokasi</label>
                    <input class="sm-input sm-input--plain" t-model="f.lokasi" placeholder="Alamat / nama tempat"/>
                </div>
                <div class="sm-field">
                    <label class="sm-label">Deskripsi &amp; Tujuan</label>
                    <textarea class="sm-textarea" t-model="f.deskripsi" placeholder="Bentuk kegiatan, sasaran warga, strategi penggalangan suara..."/>
                </div>
                <div class="sm-field" style="margin-bottom:0;">
                    <label class="sm-label">Target DPT Tersurvey <span class="sm-req">*</span></label>
                    <input class="sm-input sm-input--plain" type="number" min="1" inputmode="numeric" t-model.number="f.target_dpt" placeholder="mis. 150"/>
                    <div class="sm-hint">Jumlah DPT yang ditargetkan mengisi survey selama event.</div>
                </div>
            </div>

            <div class="sm-card">
                <div class="sm-card-title"><i class="fa fa-calculator"/> Rincian Anggaran <span class="sm-req">*</span></div>
                <t t-foreach="f.anggaran" t-as="a" t-key="a_index">
                    <div class="sm-line-edit">
                        <div class="sm-line-edit-head">
                            <span class="sm-line-no" t-esc="'#' + (a_index + 1)"/>
                            <button class="sm-icon-btn" t-on-click="() => f.anggaran.splice(a_index, 1)"><i class="fa fa-times"/></button>
                        </div>
                        <input class="sm-input sm-input--plain" t-model="a.uraian" placeholder="Uraian (mis. Konsumsi peserta)"/>
                        <div class="sm-row-3">
                            <input class="sm-input sm-input--plain" type="number" min="0" step="any" inputmode="decimal" t-model.number="a.qty" placeholder="Jml"/>
                            <input class="sm-input sm-input--plain" t-model="a.satuan" placeholder="Satuan"/>
                            <input class="sm-input sm-input--plain" type="number" min="0" inputmode="numeric" t-model.number="a.harga_satuan" placeholder="Harga satuan"/>
                        </div>
                        <div class="sm-line-sub" style="text-align:right;">Subtotal: <b t-esc="this.fmtRp((a.qty || 0) * (a.harga_satuan || 0))"/></div>
                    </div>
                </t>
                <button class="sm-btn-secondary sm-btn-block" t-on-click="() => f.anggaran.push(this._emptyAnggaranLine())"><i class="fa fa-plus"/> Tambah Baris</button>
                <div class="sm-line-total"><span>Total anggaran</span><b t-esc="this.fmtRp(this.eventFormTotal)"/></div>
            </div>

            <div class="sm-submit-bar sm-action-bar">
                <button class="sm-btn-secondary" t-on-click="() => this.saveEvent(false)" t-att-disabled="state.submitting"><i class="fa fa-save"/> Simpan Draft</button>
                <button class="sm-btn-primary" t-on-click="() => this.askConfirm('Simpan dan ajukan event ini ke admin pusat? Setelah diajukan, data tidak bisa diubah.', () => this.saveEvent(true))" t-att-disabled="state.submitting">
                    <t t-if="state.submitting"><span class="sm-spinner"/></t>
                    <t t-else=""><i class="fa fa-paper-plane"/></t> Ajukan
                </button>
            </div>
        </div>
    </t>

    <!-- ══ SUBPAGE: BERITA ACARA ══ -->
    <t t-if="state.subpage === 'event-ba'">
        <div class="sm-page-body">
            <t t-set="b" t-value="state.baForm"/>
            <div class="sm-card">
                <div class="sm-card-title"><i class="fa fa-file-text-o"/> Pelaksanaan</div>
                <div class="sm-field">
                    <label class="sm-label">Ringkasan Pelaksanaan <span class="sm-req">*</span></label>
                    <textarea class="sm-textarea" t-model="b.ringkasan" placeholder="Jalannya kegiatan, respon warga, kendala..."/>
                </div>
                <div class="sm-field">
                    <label class="sm-label">Jumlah Peserta Hadir</label>
                    <input class="sm-input sm-input--plain" type="number" min="0" inputmode="numeric" t-model.number="b.jumlah_peserta"/>
                </div>
                <label class="sm-label">Foto Kegiatan</label>
                <t t-if="b.fotoPreview">
                    <div class="sm-foto-preview"><img t-att-src="b.fotoPreview"/></div>
                    <button class="sm-btn-secondary" style="margin-top:8px;" t-on-click="() => this.pickBaFoto(-1)"><i class="fa fa-camera"/> Ganti Foto</button>
                </t>
                <t t-else="">
                    <div class="sm-foto-zone" t-on-click="() => this.pickBaFoto(-1)">
                        <i class="fa fa-camera"/><div class="sm-foto-zone-text">Ketuk untuk ambil/pilih foto kegiatan</div>
                    </div>
                </t>
            </div>

            <div class="sm-card">
                <div class="sm-card-title"><i class="fa fa-money"/> Rincian Penggunaan Dana <span class="sm-req">*</span></div>
                <t t-foreach="b.realisasi" t-as="r" t-key="r.key">
                    <div class="sm-line-edit">
                        <div class="sm-line-edit-head">
                            <span class="sm-line-no" t-esc="'#' + (r_index + 1)"/>
                            <button class="sm-icon-btn" t-on-click="() => b.realisasi.splice(r_index, 1)"><i class="fa fa-times"/></button>
                        </div>
                        <input class="sm-input sm-input--plain" t-model="r.uraian" placeholder="Uraian (mis. Sewa tenda)"/>
                        <div class="sm-line-edit-row">
                            <input class="sm-input sm-input--plain" type="number" min="0" inputmode="numeric" t-model.number="r.jumlah" placeholder="Jumlah (Rp)"/>
                            <button t-attf-class="sm-bukti-btn {{ r.buktiPreview ? 'sm-bukti-btn--ok' : '' }}" t-on-click="() => this.pickBaFoto(r_index)">
                                <t t-if="r.buktiPreview"><img t-att-src="r.buktiPreview"/></t>
                                <t t-else=""><i class="fa fa-camera"/> Nota</t>
                            </button>
                        </div>
                    </div>
                </t>
                <button class="sm-btn-secondary sm-btn-block" t-on-click="addBaLine"><i class="fa fa-plus"/> Tambah Baris</button>
                <div class="sm-line-total"><span>Dana disetujui</span><b t-esc="this.fmtRp(b.dana_disetujui)"/></div>
                <div class="sm-line-total"><span>Total realisasi</span><b t-esc="this.fmtRp(this.baTotal)"/></div>
                <div t-attf-class="sm-line-total {{ b.dana_disetujui - this.baTotal &lt; 0 ? 'sm-line-total--over' : 'sm-line-total--ok' }}">
                    <span t-esc="b.dana_disetujui - this.baTotal &lt; 0 ? 'Lebih bayar' : 'Sisa dana'"/>
                    <b t-esc="this.fmtRp(Math.abs(b.dana_disetujui - this.baTotal))"/>
                </div>
            </div>
            <input type="file" accept="image/*" capture="environment" style="display:none;" t-ref="baFotoInput" t-on-change="onBaFotoChange"/>

            <div class="sm-submit-bar">
                <button class="sm-btn-primary sm-btn-block" t-on-click="() => this.askConfirm('Kirim berita acara ke admin pusat? Setelah dikirim, data hanya bisa diubah bila dikembalikan admin.', () => this.submitBa())" t-att-disabled="state.submitting">
                    <t t-if="state.submitting"><span class="sm-spinner"/><span>Mengirim...</span></t>
                    <t t-else=""><i class="fa fa-paper-plane"/><span>Kirim Berita Acara</span></t>
                </button>
            </div>
        </div>
    </t>

    <!-- Bottom Navigation -->
    <nav class="sm-bottom-nav">
        <button t-attf-class="sm-nav-item {{ state.tab === 'home' ? 'active' : '' }}" t-on-click="() => this.switchTab('home')">
            <div class="sm-nav-icon-wrap"><i class="fa fa-home"/></div>
            <span>Beranda</span>
        </button>
        <button t-attf-class="sm-nav-item {{ state.tab === 'dpt' ? 'active' : '' }}" t-on-click="() => this.switchTab('dpt')">
            <div class="sm-nav-icon-wrap"><i class="fa fa-users"/></div>
            <span>DPT</span>
        </button>
        <button t-attf-class="sm-nav-item {{ state.tab === 'survey' ? 'active' : '' }}" t-on-click="() => this.switchTab('survey')">
            <div class="sm-nav-icon-wrap"><i class="fa fa-comments"/></div>
            <span>Survey</span>
        </button>
        <button t-attf-class="sm-nav-item {{ state.tab === 'event' ? 'active' : '' }}" t-on-click="() => this.switchTab('event')">
            <div class="sm-nav-icon-wrap"><i class="fa fa-flag"/></div>
            <span>Event</span>
        </button>
        <button t-attf-class="sm-nav-item {{ state.tab === 'profil' ? 'active' : '' }}" t-on-click="() => this.switchTab('profil')">
            <div class="sm-nav-icon-wrap"><i class="fa fa-user-circle"/></div>
            <span>Profil</span>
        </button>
    </nav>

    <!-- Toast -->
    <div t-attf-class="sm-toast sm-toast--{{state.toast.type}} {{ state.toast.show ? 'sm-toast--show' : '' }}">
        <i t-attf-class="fa {{ state.toast.type === 'success' ? 'fa-check' : state.toast.type === 'error' ? 'fa-times' : 'fa-info-circle' }}"/>
        <span t-esc="state.toast.text"/>
    </div>

    <!-- Generic Confirm Dialog -->
    <t t-if="state.confirm">
        <div class="sm-confirm-overlay" t-on-click="onConfirmOverlayClick">
            <div class="sm-confirm-box">
                <div class="sm-confirm-icon"><i class="fa fa-question-circle"/></div>
                <div class="sm-confirm-msg" t-esc="state.confirm.msg"/>
                <div class="sm-confirm-actions">
                    <button class="sm-btn-secondary" t-on-click="() => this.state.confirm = null">Batal</button>
                    <button class="sm-btn-primary" t-on-click="runConfirm">Ya, Lanjutkan</button>
                </div>
            </div>
        </div>
    </t>

    <!-- Confirm Logout Dialog -->
    <t t-if="state.confirmLogout">
        <div class="sm-confirm-overlay" t-on-click="onLogoutOverlayClick">
            <div class="sm-confirm-box">
                <div class="sm-confirm-icon"><i class="fa fa-sign-out"/></div>
                <div class="sm-confirm-msg">Yakin ingin keluar dari akun?</div>
                <div class="sm-confirm-actions">
                    <button class="sm-btn-secondary" t-on-click="() => this.state.confirmLogout = false">Batal</button>
                    <button class="sm-btn-primary" t-on-click="logout"><i class="fa fa-sign-out"/> Keluar</button>
                </div>
            </div>
        </div>
    </t>

</div>`;

        setup() {
            this.initData = JSON.parse(document.getElementById('sm-app-root').dataset.init || '{}');
            this.mapRef = useRef('gpsMap');
            this.photoInputRef = useRef('photoInput');
            this.baFotoInputRef = useRef('baFotoInput');
            this._baFotoTarget = -1;   // -1 = foto kegiatan, >=0 = index baris realisasi
            this._lineKey = 0;
            this.surveyFotoInputRef = useRef('surveyFotoInput');
            this.weeklyChartRef = useRef('weeklyChart');
            this._map = null;
            this._marker = null;
            this._weeklyChart = null;
            this._toastTimer = null;
            this._onWeeklyResize = () => this._weeklyChart?.resize();

            this.state = useState({
                tab: 'home',
                subpage: null,
                submitting: false,
                toast: { show: false, text: '', type: 'info' },

                kpi: null,

                dptList: [], dptTotal: 0, dptSearch: '', dptStateFilter: null, dptListLoading: false,
                dptDetail: null, dptDetailLoading: false,
                dptForm: this._emptyDptForm(),
                tpsOptions: [],

                surveyList: [], surveyTotal: 0, surveyListLoading: false,
                surveyForm: this._emptySurveyForm(),
                dptPickSearch: '', dptPickResults: [], dptPickLoading: false,

                avatarSrc: this.initData.relawan_has_foto
                    ? `/web/image/smartpolling.relawan/${this.initData.relawan_id}/foto?ts=${Date.now()}`
                    : null,

                gpsAccuracy: null,
                gpsLoading: false,

                // Berita & Agenda
                infoHome: null,
                infoTab: 'berita',
                beritaList: [], beritaTotal: 0, beritaSearch: '', beritaLoading: false,
                agendaList: [], agendaTotal: 0, agendaMode: 'upcoming', agendaLoading: false,
                beritaDetail: null,
                agendaDetail: null,

                // Subpage bertumpuk: kembali (←) membuka subpage sebelumnya
                subpageStack: [],

                // Event
                eventList: [], eventTotal: 0, eventGroup: null, eventLoading: false,
                eventDetail: null,
                eventForm: null,
                baForm: null,
                activeEvents: [],

                confirm: null,          // { msg, onOk }
                confirmLogout: false,
            });

            onMounted(() => {
                this._loadKpi();
                this._loadWeeklyChart();
                this._loadInfoHome();
                window.addEventListener('resize', this._onWeeklyResize);
            });

            useEffect(
                () => {
                    if (this.state.subpage === 'dpt-add') {
                        this._loadTpsOptions();
                        setTimeout(() => this._initGpsMap(), 50);
                    } else if (this._map) {
                        this._map.remove();
                        this._map = null;
                        this._marker = null;
                    }
                },
                () => [this.state.subpage]
            );

            onWillUnmount(() => {
                if (this._map) this._map.remove();
                if (this._weeklyChart) this._weeklyChart.dispose();
                window.removeEventListener('resize', this._onWeeklyResize);
                clearTimeout(this._toastTimer);
            });
        }

        // ── Empty form factories ──────────────────────────────────────────
        _emptyDptForm() {
            return {
                nama: '', nik: '', jenis_kelamin: '', tps_id: '', hp: '', alamat: '',
                agama: '', pekerjaan: '', tempat_lahir: '', tanggal_lahir: '',
                latitude: 0, longitude: 0,
            };
        }
        _emptySurveyForm() {
            return { dpt_id: null, dpt_name: '', pilihan: '', fotoBase64: null, fotoPreview: null, event_id: '' };
        }
        _emptyAnggaranLine() {
            return { uraian: '', qty: 1, satuan: '', harga_satuan: null };
        }

        // ── Getters / helpers dipakai di template ─────────────────────────
        get initials() {
            const name = (this.initData.relawan_name || '?').trim();
            const parts = name.split(/\s+/);
            return ((parts[0]?.[0] || '') + (parts[1]?.[0] || '')).toUpperCase() || '?';
        }
        get subpageTitle() {
            return {
                'dpt-detail': 'Detail DPT',
                'dpt-add': 'Tambah DPT',
                'survey-add': 'Tambah Survey',
                'berita-detail': 'Berita',
                'agenda-detail': 'Detail Agenda',
                'info': 'Berita & Agenda',
                'event-detail': 'Detail Event',
                'event-form': this.state.eventForm && this.state.eventForm.id ? 'Edit Event' : 'Ajukan Event',
                'event-ba': 'Berita Acara',
            }[this.state.subpage] || '';
        }
        get eventGroups() {
            return [
                { key: null, label: 'Semua' },
                { key: 'proses', label: 'Pengajuan' },
                { key: 'berjalan', label: 'Disetujui' },
                { key: 'selesai', label: 'Selesai' },
                { key: 'ditolak', label: 'Ditolak' },
            ];
        }
        get eventFormTotal() {
            const f = this.state.eventForm;
            return f ? f.anggaran.reduce((s, a) => s + (Number(a.qty) || 0) * (Number(a.harga_satuan) || 0), 0) : 0;
        }
        get baTotal() {
            const b = this.state.baForm;
            return b ? b.realisasi.reduce((s, r) => s + (Number(r.jumlah) || 0), 0) : 0;
        }
        eventStateLabel(v) { return EVENT_STATE_LABELS[v] || v; }
        // Catatan: jangan pakai global seperti String()/Number() langsung di template Owl —
        // Owl membacanya sebagai variabel context (undefined) dan seluruh app crash.
        isSurveyEvent(id) { return String(id) === String(this.state.surveyForm.event_id || ''); }
        fmtRp(v) { return RP.format(Number(v) || 0); }
        fmtNum(v) { return NUM.format(Number(v) || 0); }
        pct(a, b) { return b ? Math.min(100, Math.round((a || 0) / b * 100)) : 0; }
        cmpWidth(row, rows) {
            const max = Math.max(1, ...rows.map((r) => Number(r.value) || 0));
            return Math.round((Number(row.value) || 0) / max * 100);
        }
        eventHint(ev) {
            switch (ev.state) {
                case 'draft':
                    return { type: 'warning', icon: 'fa-pencil', text: ev.catatan_admin
                        ? 'Admin meminta revisi. Perbaiki pengajuan lalu ajukan ulang.'
                        : 'Draft belum diajukan. Lengkapi rincian anggaran lalu ketuk Ajukan.' };
                case 'diajukan':
                    return { type: 'warning', icon: 'fa-hourglass-half', text: 'Menunggu persetujuan pendanaan dari admin pusat.' };
                case 'ditolak':
                    return { type: 'error', icon: 'fa-ban', text: 'Pengajuan event ini ditolak admin pusat.' };
                case 'disetujui':
                    return ev.can_lapor
                        ? { type: 'success', icon: 'fa-check-circle', text: 'Event disetujui & didanai. Tandai survey selama event, lalu isi berita acara setelah selesai.' }
                        : { type: 'success', icon: 'fa-check-circle', text: 'Event disetujui & didanai. Berita acara bisa diisi setelah event dimulai.' };
                case 'laporan':
                    return { type: 'warning', icon: 'fa-hourglass-half', text: 'Berita acara terkirim, menunggu verifikasi admin pusat.' };
                default:
                    return { type: 'success', icon: 'fa-flag-checkered', text: 'Event selesai dan telah diverifikasi admin pusat.' };
            }
        }

        // ── Konfirmasi generik ─────────────────────────────────────────────
        askConfirm(msg, onOk) { this.state.confirm = { msg, onOk }; }
        runConfirm() {
            const c = this.state.confirm;
            this.state.confirm = null;
            if (c && c.onOk) c.onOk();
        }
        onConfirmOverlayClick(e) {
            if (e.target === e.currentTarget) this.state.confirm = null;
        }
        get kpiCards() {
            const k = this.state.kpi || {};
            return [
                { key: 'dpt', icon: 'fa-users', color: '#2874A6', bg: '#eaf2f8', value: k.total_dpt || 0, label: 'Total DPT Saya' },
                { key: 'verif', icon: 'fa-check-circle', color: '#27AE60', bg: '#e8f8ee', value: k.total_terverifikasi || 0, label: 'Terverifikasi' },
                { key: 'belum', icon: 'fa-exclamation-circle', color: '#F39C12', bg: '#fef3e0', value: k.total_belum_survey || 0, label: 'Belum Disurvey' },
                { key: 'tps', icon: 'fa-building', color: '#8E44AD', bg: '#f2e9f8', value: k.total_tps || 0, label: 'TPS Dikoordinir' },
            ];
        }
        fmtDate(dtStr) { return fmtDate(dtStr); }
        pilihanLabel(v) { return PILIHAN_LABELS[v] || v; }
        stateLabel(v) { return STATE_LABELS[v] || v; }
        fmtDateOnly(dtStr) { return fmtDateOnly(dtStr); }
        fmtAgendaWaktu(mulai, selesai) { return fmtAgendaWaktu(mulai, selesai); }
        agendaDay(dtStr) { const d = parseUtc(dtStr); return d ? d.getDate() : '-'; }
        agendaMon(dtStr) {
            const d = parseUtc(dtStr);
            return d ? d.toLocaleDateString('id-ID', { month: 'short' }).replace('.', '') : '';
        }
        // HTML isi berita/agenda sudah di-sanitize server (fields.Html sanitize=True)
        html(s) { return markup(s || ''); }
        beritaImg(id, size) { return `/web/image/smartpolling.berita/${id}/gambar/${size}`; }

        // ── Toast ──────────────────────────────────────────────────────────
        toast(text, type = 'info') {
            this.state.toast = { show: true, text, type };
            clearTimeout(this._toastTimer);
            this._toastTimer = setTimeout(() => { this.state.toast.show = false; }, 3200);
        }

        // ── Navigasi ───────────────────────────────────────────────────────
        switchTab(tab) {
            this.state.tab = tab;
            this.resetSubpages();
            if (tab === 'home') {
                this._loadKpi();
                this._loadWeeklyChart();
                this._loadInfoHome();
            }
            if (tab === 'event') this._loadEventList(true);
            if (tab === 'dpt' && !this.state.dptList.length) this._loadDptList(true);
            if (tab === 'survey' && !this.state.surveyList.length) this._loadSurveyList(true);
        }
        // Buka subpage di atas subpage saat ini (kalau ada) — tombol kembali akan balik ke sana
        pushSubpage(name) {
            if (this.state.subpage && this.state.subpage !== name) this.state.subpageStack.push(this.state.subpage);
            this.state.subpage = name;
        }
        // Tutup subpage tanpa reload (dipakai saat gagal memuat)
        popSubpage() {
            this.state.subpage = this.state.subpageStack.pop() || null;
        }
        resetSubpages() {
            this.state.subpageStack = [];
            this.state.subpage = null;
        }
        closeSubpage() {
            const wasSubpage = this.state.subpage;
            this.popSubpage();
            const now = this.state.subpage;
            if (now === 'event-detail' && this.state.eventDetail) {
                this._reloadEventDetail();
            } else if (!now) {
                if (wasSubpage === 'dpt-detail' || wasSubpage === 'dpt-add') this._loadDptList(true);
                if (wasSubpage === 'survey-add') this._loadSurveyList(true);
                if (this.state.tab === 'event' && wasSubpage && wasSubpage.startsWith('event')) this._loadEventList(true);
            }
        }
        onKpiClick(key) {
            if (key === 'belum') {
                this.state.dptStateFilter = null;
                this.state.tab = 'dpt';
                this._loadDptList(true, { belum_survey: true });
            } else if (key === 'verif') {
                this.filterDptState('terverifikasi');
                this.state.tab = 'dpt';
            } else if (key === 'tps') {
                this.state.tab = 'dpt';
                this.filterDptState(null);
            } else {
                this.filterDptState(null);
                this.state.tab = 'dpt';
            }
        }
        askLogout() { this.state.confirmLogout = true; }
        onLogoutOverlayClick(e) {
            if (e.target === e.currentTarget) this.state.confirmLogout = false;
        }
        logout() { window.location.href = '/mobile/logout'; }

        // ── KPI ────────────────────────────────────────────────────────────
        async _loadKpi() {
            try {
                const res = await rpc('/mobile/api/kpi', {});
                if (res.error) return;
                this.state.kpi = res;
            } catch (e) { console.error(e); }
        }

        async _loadWeeklyChart() {
            try {
                const res = await rpc('/mobile/api/weekly', {});
                const days = (res && res.days) || [];
                const el = this.weeklyChartRef?.el;
                if (!el || typeof echarts === 'undefined' || !days.length) return;

                const labels = days.map((d) => d.label);
                const counts = days.map((d) => d.count);

                if (this._weeklyChart) this._weeklyChart.dispose();
                this._weeklyChart = echarts.init(el);
                this._weeklyChart.setOption({
                    grid: { left: 6, right: 6, top: 14, bottom: 0, containLabel: true },
                    xAxis: {
                        type: 'category', data: labels,
                        axisLabel: { fontSize: 11, color: '#9c8b96' },
                        axisTick: { show: false }, axisLine: { show: false },
                    },
                    yAxis: {
                        type: 'value', minInterval: 1,
                        max: (v) => Math.ceil(v.max * 1.25) || 5,
                        splitLine: { lineStyle: { color: '#f0e8ec', type: 'dashed' } },
                        axisLabel: { fontSize: 10, color: '#b8a8b1' },
                    },
                    series: [{
                        type: 'bar',
                        data: counts.map((v, i) => ({
                            value: v,
                            itemStyle: { color: i === days.length - 1 ? '#714B67' : '#d9c3d0', borderRadius: [4, 4, 0, 0] },
                        })),
                        barMaxWidth: 36,
                        label: {
                            show: true, position: 'top', fontSize: 10, color: '#714B67',
                            formatter: (p) => (p.value > 0 ? p.value : ''),
                        },
                    }],
                    tooltip: {
                        trigger: 'axis', backgroundColor: '#3d2c37', borderWidth: 0,
                        textStyle: { color: '#fff', fontSize: 12 },
                        formatter: (p) => `<b>${p[0].name}</b>: ${p[0].value} survey`,
                    },
                });
            } catch (e) { console.error(e); }
        }

        // ── DPT list ───────────────────────────────────────────────────────
        onDptSearchKey(ev) {
            clearTimeout(this._searchTimer);
            this._searchTimer = setTimeout(() => this._loadDptList(true), 350);
        }
        filterDptState(state) {
            this.state.dptStateFilter = state;
            this._loadDptList(true);
        }
        async _loadDptList(reset, extra) {
            if (this.state.dptListLoading) return;
            this.state.dptListLoading = true;
            if (reset) this.state.dptList = [];
            try {
                const res = await rpc('/mobile/api/dpt/list', Object.assign({
                    offset: reset ? 0 : this.state.dptList.length,
                    limit: 20,
                    search: this.state.dptSearch || null,
                    state: this.state.dptStateFilter,
                }, extra || {}));
                if (res.error) { this.toast(res.error, 'error'); return; }
                this.state.dptList = reset ? res.records : this.state.dptList.concat(res.records);
                this.state.dptTotal = res.total;
            } catch (e) {
                this.toast('Gagal memuat data DPT', 'error');
            } finally {
                this.state.dptListLoading = false;
            }
        }
        loadMoreDpt() { this._loadDptList(false); }

        // ── DPT detail ─────────────────────────────────────────────────────
        async openDptDetail(id) {
            if (!id) return;
            this.pushSubpage('dpt-detail');
            this.state.dptDetail = null;
            this.state.dptDetailLoading = true;
            try {
                const res = await rpc('/mobile/api/dpt/record', { dpt_id: id });
                if (res.error) { this.toast('Gagal memuat detail DPT', 'error'); this.popSubpage(); return; }
                this.state.dptDetail = res;
            } catch (e) {
                this.toast('Gagal memuat detail DPT', 'error');
                this.popSubpage();
            } finally {
                this.state.dptDetailLoading = false;
            }
        }
        // ── DPT add ────────────────────────────────────────────────────────
        openDptAdd() {
            this.state.dptForm = this._emptyDptForm();
            this.state.gpsAccuracy = null;
            this.pushSubpage('dpt-add');
        }
        async _loadTpsOptions() {
            try {
                const res = await rpc('/mobile/api/dpt/tps_options', {});
                this.state.tpsOptions = res.records || [];
            } catch (e) { console.error(e); }
        }
        requestGps() {
            if (!navigator.geolocation) return this.toast('Perangkat tidak mendukung GPS', 'error');
            this.state.gpsLoading = true;
            navigator.geolocation.getCurrentPosition(
                (pos) => {
                    const lat = pos.coords.latitude, lng = pos.coords.longitude;
                    this.state.dptForm.latitude = Number(lat.toFixed(6));
                    this.state.dptForm.longitude = Number(lng.toFixed(6));
                    this.state.gpsAccuracy = pos.coords.accuracy;
                    this.state.gpsLoading = false;
                    this._placeMarker(lat, lng);
                    if (this._map) this._map.setView([lat, lng], 16);
                    this.toast('Lokasi berhasil diambil', 'success');
                },
                (err) => {
                    this.state.gpsLoading = false;
                    const msg = err.code === 1 ? 'Akses GPS ditolak'
                        : err.code === 2 ? 'Posisi tidak tersedia' : 'Waktu pengambilan GPS habis';
                    this.toast(msg, 'error');
                },
                { enableHighAccuracy: true, timeout: 10000 }
            );
        }
        _initGpsMap() {
            const el = this.mapRef.el;
            if (!el || typeof L === 'undefined' || this._map) return;
            const hasCoords = !!this.state.dptForm.latitude;
            const lat = this.state.dptForm.latitude || -2.5;
            const lng = this.state.dptForm.longitude || 117.5;
            this._map = L.map(el).setView([lat, lng], hasCoords ? 16 : 5);
            L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
                attribution: '&copy; OpenStreetMap',
            }).addTo(this._map);
            if (hasCoords) this._placeMarker(lat, lng);
            this._map.on('click', (e) => {
                this.state.dptForm.latitude = Number(e.latlng.lat.toFixed(6));
                this.state.dptForm.longitude = Number(e.latlng.lng.toFixed(6));
                this._placeMarker(e.latlng.lat, e.latlng.lng);
            });
            setTimeout(() => this._map && this._map.invalidateSize(), 150);
        }
        _placeMarker(lat, lng) {
            if (!this._map) return;
            if (this._marker) { this._marker.setLatLng([lat, lng]); return; }
            this._marker = L.marker([lat, lng], { draggable: true }).addTo(this._map);
            this._marker.on('dragend', () => {
                const p = this._marker.getLatLng();
                this.state.dptForm.latitude = Number(p.lat.toFixed(6));
                this.state.dptForm.longitude = Number(p.lng.toFixed(6));
            });
        }
        async submitDpt() {
            const f = this.state.dptForm;
            if (!f.nama.trim()) return this.toast('Nama wajib diisi', 'error');
            if (!/^\d{16}$/.test(f.nik.trim())) return this.toast('NIK harus 16 digit angka', 'error');
            if (!f.jenis_kelamin) return this.toast('Pilih jenis kelamin', 'error');
            if (!f.tps_id) return this.toast('Pilih TPS', 'error');
            if (!f.latitude || !f.longitude) return this.toast('Ambil koordinat GPS terlebih dahulu', 'error');

            this.state.submitting = true;
            try {
                const res = await rpc('/mobile/api/dpt/create', { data: f });
                if (res.error) return this.toast(res.error, 'error');
                this.toast('DPT berhasil ditambahkan', 'success');
                this.resetSubpages();
                this.state.tab = 'dpt';
                this._loadDptList(true);
                this._loadKpi();
            } catch (e) {
                this.toast('Gagal menyimpan data DPT', 'error');
            } finally {
                this.state.submitting = false;
            }
        }

        // ── Survey list ────────────────────────────────────────────────────
        async _loadSurveyList(reset) {
            if (this.state.surveyListLoading) return;
            this.state.surveyListLoading = true;
            if (reset) this.state.surveyList = [];
            try {
                const res = await rpc('/mobile/api/survey/list', {
                    offset: reset ? 0 : this.state.surveyList.length,
                    limit: 20,
                });
                if (res.error) { this.toast(res.error, 'error'); return; }
                this.state.surveyList = reset ? res.records : this.state.surveyList.concat(res.records);
                this.state.surveyTotal = res.total;
            } catch (e) {
                this.toast('Gagal memuat riwayat survey', 'error');
            } finally {
                this.state.surveyListLoading = false;
            }
        }
        loadMoreSurvey() { this._loadSurveyList(false); }

        // ── Survey add ─────────────────────────────────────────────────────
        openSurveyAddFor(dptId, dptName, eventId) {
            this.state.surveyForm = Object.assign(this._emptySurveyForm(),
                dptId ? { dpt_id: dptId, dpt_name: dptName } : {},
                eventId ? { event_id: String(eventId) } : {});
            this.state.dptPickSearch = '';
            this.state.dptPickResults = [];
            this.pushSubpage('survey-add');
            this._loadActiveEvents(eventId);
        }
        async _loadActiveEvents(presetId) {
            try {
                const res = await rpc('/mobile/api/event/active', {});
                this.state.activeEvents = res.records || [];
                // Kalau hanya ada 1 event aktif & tidak dipilih eksplisit, pilih otomatis (masih bisa diganti)
                if (!presetId && this.state.activeEvents.length === 1 && !this.state.surveyForm.event_id) {
                    this.state.surveyForm.event_id = String(this.state.activeEvents[0].id);
                }
            } catch (e) { this.state.activeEvents = []; }
        }
        onDptPickSearchKey() {
            clearTimeout(this._pickTimer);
            const q = this.state.dptPickSearch;
            if (!q || q.length < 2) { this.state.dptPickResults = []; return; }
            this._pickTimer = setTimeout(async () => {
                this.state.dptPickLoading = true;
                try {
                    const res = await rpc('/mobile/api/dpt/list', { offset: 0, limit: 10, search: q });
                    this.state.dptPickResults = res.records || [];
                } catch (e) { /* ignore */ } finally {
                    this.state.dptPickLoading = false;
                }
            }, 350);
        }
        pickDptForSurvey(id, nama) {
            this.state.surveyForm.dpt_id = id;
            this.state.surveyForm.dpt_name = nama;
        }
        triggerSurveyFotoInput() { this.surveyFotoInputRef.el?.click(); }
        async onSurveyFotoChange(ev) {
            const file = ev.target.files[0];
            if (!file) return;
            try {
                const dataUrl = await compressImage(file);
                this.state.surveyForm.fotoPreview = dataUrl;
                this.state.surveyForm.fotoBase64 = dataUrl.split(',')[1];
            } catch (e) {
                this.toast('Gagal memproses foto', 'error');
            }
        }
        clearSurveyFoto() {
            this.state.surveyForm.fotoPreview = null;
            this.state.surveyForm.fotoBase64 = null;
        }
        async submitSurvey() {
            const f = this.state.surveyForm;
            if (!f.dpt_id) return this.toast('Pilih DPT terlebih dahulu', 'error');
            if (!f.pilihan) return this.toast('Pilih preferensi pilihan', 'error');

            this.state.submitting = true;
            try {
                const res = await rpc('/mobile/api/survey/create', {
                    dpt_id: f.dpt_id, pilihan: f.pilihan, foto: f.fotoBase64 || null,
                    event_id: f.event_id ? Number(f.event_id) : null,
                });
                if (res.error) return this.toast(res.error, 'error');
                this._loadKpi();
                this.state.surveyList = [];   // dimuat ulang saat tab Survey dibuka
                if (f.event_id) {
                    // Survey event: form tetap terbuka untuk DPT berikutnya, event tetap terpilih
                    this.toast('Survey event tersimpan. Lanjut DPT berikutnya.', 'success');
                    this.state.surveyForm = Object.assign(this._emptySurveyForm(), { event_id: f.event_id });
                    this.state.dptPickSearch = '';
                    this.state.dptPickResults = [];
                    return;
                }
                this.toast('Survey berhasil disimpan', 'success');
                this.resetSubpages();
                this.state.tab = 'survey';
                this._loadSurveyList(true);
            } catch (e) {
                this.toast('Gagal menyimpan survey', 'error');
            } finally {
                this.state.submitting = false;
            }
        }

        // ── Berita & Agenda ────────────────────────────────────────────────
        async _loadInfoHome() {
            try {
                const res = await rpc('/mobile/api/info/home', {});
                if (!res.error) this.state.infoHome = res;
            } catch (e) { console.error(e); }
        }
        openInfo(which) {
            this.state.infoTab = which;
            this.resetSubpages();
            this.pushSubpage('info');
            // selalu refresh supaya berita/agenda baru dari admin langsung terlihat
            if (which === 'berita') this._loadBeritaList(true);
            else this._loadAgendaList(true);
        }
        switchInfoTab(which) {
            if (this.state.infoTab === which) return;
            this.state.infoTab = which;
            if (which === 'berita') this._loadBeritaList(true);
            else this._loadAgendaList(true);
        }
        onBeritaSearchKey() {
            clearTimeout(this._beritaSearchTimer);
            this._beritaSearchTimer = setTimeout(() => this._loadBeritaList(true), 350);
        }
        async _loadBeritaList(reset) {
            if (this.state.beritaLoading) return;
            this.state.beritaLoading = true;
            if (reset) this.state.beritaList = [];
            try {
                const res = await rpc('/mobile/api/berita/list', {
                    offset: reset ? 0 : this.state.beritaList.length,
                    limit: 20,
                    search: this.state.beritaSearch || null,
                });
                if (res.error) { this.toast(res.error, 'error'); return; }
                this.state.beritaList = reset ? res.records : this.state.beritaList.concat(res.records);
                this.state.beritaTotal = res.total;
            } catch (e) {
                this.toast('Gagal memuat berita', 'error');
            } finally {
                this.state.beritaLoading = false;
            }
        }
        switchAgendaMode(mode) {
            if (this.state.agendaMode === mode) return;
            this.state.agendaMode = mode;
            this._loadAgendaList(true);
        }
        async _loadAgendaList(reset) {
            if (this.state.agendaLoading) return;
            this.state.agendaLoading = true;
            if (reset) this.state.agendaList = [];
            try {
                const res = await rpc('/mobile/api/agenda/list', {
                    mode: this.state.agendaMode,
                    offset: reset ? 0 : this.state.agendaList.length,
                    limit: 20,
                });
                if (res.error) { this.toast(res.error, 'error'); return; }
                this.state.agendaList = reset ? res.records : this.state.agendaList.concat(res.records);
                this.state.agendaTotal = res.total;
            } catch (e) {
                this.toast('Gagal memuat agenda', 'error');
            } finally {
                this.state.agendaLoading = false;
            }
        }
        async openBeritaDetail(id) {
            this.state.beritaDetail = null;
            this.pushSubpage('berita-detail');
            try {
                const res = await rpc('/mobile/api/berita/record', { berita_id: id });
                if (res.error) throw new Error(res.error);
                this.state.beritaDetail = res;
            } catch (e) {
                this.toast('Berita tidak ditemukan', 'error');
                this.popSubpage();
            }
        }
        async openAgendaDetail(id) {
            this.state.agendaDetail = null;
            this.pushSubpage('agenda-detail');
            try {
                const res = await rpc('/mobile/api/agenda/record', { agenda_id: id });
                if (res.error) throw new Error(res.error);
                this.state.agendaDetail = res;
            } catch (e) {
                this.toast('Agenda tidak ditemukan', 'error');
                this.popSubpage();
            }
        }

        // ── Event ──────────────────────────────────────────────────────────
        openEventTab(group) {
            this.state.eventGroup = group || null;
            this.switchTab('event');
        }
        filterEventGroup(group) {
            this.state.eventGroup = group;
            this._loadEventList(true);
        }
        async _loadEventList(reset) {
            if (this.state.eventLoading) return;
            this.state.eventLoading = true;
            if (reset) this.state.eventList = [];
            try {
                const res = await rpc('/mobile/api/event/list', {
                    group: this.state.eventGroup,
                    offset: reset ? 0 : this.state.eventList.length,
                    limit: 20,
                });
                if (res.error) { this.toast(res.error, 'error'); return; }
                this.state.eventList = reset ? res.records : this.state.eventList.concat(res.records);
                this.state.eventTotal = res.total;
            } catch (e) {
                this.toast('Gagal memuat event', 'error');
            } finally {
                this.state.eventLoading = false;
            }
        }
        async openEventDetail(id) {
            this.state.eventDetail = null;
            this.pushSubpage('event-detail');
            if (!(await this._fetchEventDetail(id))) this.popSubpage();
        }
        async _fetchEventDetail(id) {
            try {
                const res = await rpc('/mobile/api/event/record', { event_id: id });
                if (res.error) throw new Error(res.error);
                this.state.eventDetail = res;
                return true;
            } catch (e) {
                this.toast('Event tidak ditemukan', 'error');
                return false;
            }
        }
        _reloadEventDetail() {
            if (this.state.eventDetail) this._fetchEventDetail(this.state.eventDetail.id);
        }
        openEventForm(ev) {
            const now = new Date();
            const besok = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 9, 0);
            const toLocal = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
            this.state.eventForm = ev ? {
                id: ev.id,
                nama: ev.nama,
                mulai: utcToLocalInput(ev.mulai),
                selesai: utcToLocalInput(ev.selesai),
                lokasi: ev.lokasi,
                deskripsi: ev.deskripsi,
                target_dpt: ev.target_dpt || null,
                anggaran: ev.anggaran.map((a) => ({ uraian: a.uraian, qty: a.qty, satuan: a.satuan, harga_satuan: a.harga_satuan })),
            } : {
                id: null, nama: '', lokasi: '', deskripsi: '', target_dpt: null,
                mulai: toLocal(besok),
                selesai: toLocal(new Date(besok.getTime() + 3 * 3600 * 1000)),
                anggaran: [this._emptyAnggaranLine()],
            };
            this.pushSubpage('event-form');
        }
        async saveEvent(ajukan) {
            const f = this.state.eventForm;
            if (!f.nama.trim()) return this.toast('Nama event wajib diisi', 'error');
            const mulai = localInputToUtc(f.mulai), selesai = localInputToUtc(f.selesai);
            if (!mulai || !selesai) return this.toast('Isi waktu mulai dan selesai', 'error');
            if (selesai < mulai) return this.toast('Waktu selesai sebelum waktu mulai', 'error');
            const anggaran = f.anggaran.filter((a) => (a.uraian || '').trim() || a.harga_satuan);
            if (anggaran.some((a) => !(a.uraian || '').trim())) return this.toast('Uraian anggaran wajib diisi', 'error');
            if (ajukan) {
                if (!(f.target_dpt > 0)) return this.toast('Isi target DPT tersurvey', 'error');
                if (!anggaran.length || !(this.eventFormTotal > 0)) return this.toast('Isi rincian anggaran', 'error');
            }
            this.state.submitting = true;
            try {
                const res = await rpc('/mobile/api/event/save', {
                    event_id: f.id,
                    ajukan: !!ajukan,
                    data: {
                        nama: f.nama, mulai, selesai, lokasi: f.lokasi, deskripsi: f.deskripsi,
                        target_dpt: f.target_dpt || 0,
                        anggaran: anggaran.map((a) => ({
                            uraian: a.uraian, qty: a.qty || 0, satuan: a.satuan, harga_satuan: a.harga_satuan || 0,
                        })),
                    },
                });
                if (res.error) return this.toast(res.error, 'error');
                this.toast(ajukan ? 'Event diajukan ke admin pusat' : 'Draft event tersimpan', 'success');
                // Form diganti dengan halaman detail event
                this.popSubpage();
                if (this.state.subpage === 'event-detail') {
                    await this._fetchEventDetail(res.id);
                } else {
                    await this.openEventDetail(res.id);
                }
            } catch (e) {
                this.toast('Gagal menyimpan event', 'error');
            } finally {
                this.state.submitting = false;
            }
        }
        async ajukanEvent(id) {
            try {
                const res = await rpc('/mobile/api/event/ajukan', { event_id: id });
                if (res.error) return this.toast(res.error, 'error');
                this.toast('Event diajukan ke admin pusat', 'success');
                this._fetchEventDetail(id);
            } catch (e) { this.toast('Gagal mengajukan event', 'error'); }
        }
        async deleteEvent(id) {
            try {
                const res = await rpc('/mobile/api/event/delete', { event_id: id });
                if (res.error) return this.toast(res.error, 'error');
                this.toast('Draft event dihapus', 'success');
                this.closeSubpage();
                if (this.state.tab !== 'event') this.switchTab('event');
            } catch (e) { this.toast('Gagal menghapus event', 'error'); }
        }

        // ── Berita acara ───────────────────────────────────────────────────
        openBaForm() {
            const ev = this.state.eventDetail;
            const stamp = encodeURIComponent(ev.ba_tanggal || '');
            this.state.baForm = {
                event_id: ev.id,
                dana_disetujui: ev.dana_disetujui,
                ringkasan: ev.ba_ringkasan,
                jumlah_peserta: ev.ba_jumlah_peserta || null,
                fotoPreview: ev.has_foto_kegiatan ? `/web/image/smartpolling.event/${ev.id}/ba_foto_kegiatan/800x0?u=${stamp}` : null,
                fotoBase64: null,
                realisasi: ev.realisasi.length
                    ? ev.realisasi.map((r) => ({
                        key: ++this._lineKey, id: r.id, uraian: r.uraian, jumlah: r.jumlah, buktiBase64: null,
                        buktiPreview: r.has_bukti ? `/web/image/smartpolling.event.realisasi/${r.id}/bukti/120x120?u=${stamp}` : null,
                    }))
                    // Prefill dari rincian anggaran supaya PIC tinggal menyesuaikan angka realisasi
                    : ev.anggaran.map((a) => ({
                        key: ++this._lineKey, id: null, uraian: a.uraian, jumlah: a.subtotal, buktiBase64: null, buktiPreview: null,
                    })),
            };
            this.pushSubpage('event-ba');
        }
        addBaLine() {
            this.state.baForm.realisasi.push({
                key: ++this._lineKey, id: null, uraian: '', jumlah: null, buktiBase64: null, buktiPreview: null,
            });
        }
        pickBaFoto(index) {
            this._baFotoTarget = index;
            const el = this.baFotoInputRef.el;
            if (el) { el.value = ''; el.click(); }
        }
        async onBaFotoChange(ev) {
            const file = ev.target.files[0];
            if (!file) return;
            try {
                const dataUrl = await compressImage(file);
                const b64 = dataUrl.split(',')[1];
                const b = this.state.baForm;
                if (this._baFotoTarget < 0) {
                    b.fotoPreview = dataUrl;
                    b.fotoBase64 = b64;
                } else if (b.realisasi[this._baFotoTarget]) {
                    b.realisasi[this._baFotoTarget].buktiPreview = dataUrl;
                    b.realisasi[this._baFotoTarget].buktiBase64 = b64;
                }
            } catch (e) {
                this.toast('Gagal memproses foto', 'error');
            }
        }
        async submitBa() {
            const b = this.state.baForm;
            if (!(b.ringkasan || '').trim()) return this.toast('Ringkasan pelaksanaan wajib diisi', 'error');
            const lines = b.realisasi.filter((r) => (r.uraian || '').trim() || r.jumlah);
            if (!lines.length) return this.toast('Isi minimal 1 rincian penggunaan dana', 'error');
            if (lines.some((r) => !(r.uraian || '').trim())) return this.toast('Uraian penggunaan dana wajib diisi', 'error');
            this.state.submitting = true;
            try {
                const res = await rpc('/mobile/api/event/laporan', {
                    event_id: b.event_id,
                    data: {
                        ringkasan: b.ringkasan,
                        jumlah_peserta: b.jumlah_peserta || 0,
                        foto_kegiatan: b.fotoBase64,
                        realisasi: lines.map((r) => ({ id: r.id, uraian: r.uraian, jumlah: r.jumlah || 0, bukti: r.buktiBase64 })),
                    },
                });
                if (res.error) return this.toast(res.error, 'error');
                this.toast('Berita acara terkirim ke admin pusat', 'success');
                this.closeSubpage();   // kembali ke detail event (otomatis dimuat ulang)
                this._loadKpi();
            } catch (e) {
                this.toast('Gagal mengirim berita acara', 'error');
            } finally {
                this.state.submitting = false;
            }
        }

        // ── Profil ─────────────────────────────────────────────────────────
        triggerPhotoInput() { this.photoInputRef.el?.click(); }
        async onProfilPhotoChange(ev) {
            const file = ev.target.files[0];
            if (!file) return;
            try {
                const dataUrl = await compressImage(file);
                const res = await rpc('/mobile/api/profile/update_photo', { foto: dataUrl.split(',')[1] });
                if (res.error) return this.toast(res.error, 'error');
                this.state.avatarSrc = dataUrl;
                this.toast('Foto profil diperbarui', 'success');
            } catch (e) {
                this.toast('Gagal memperbarui foto profil', 'error');
            }
        }
    }

    mount(App, document.getElementById('sm-app-root'), { dev: false });
})();
