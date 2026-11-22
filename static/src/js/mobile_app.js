/* ====================================================
   SMARTPOLLING — Mobile App (OWL, standalone)
   Struktur/UI-UX mengikuti pola strong_form.js (PetaDigi),
   diimplementasikan ulang memakai Owl (bukan IIFE polos).
   ==================================================== */
(function () {
    'use strict';

    const { Component, useState, useRef, onMounted, onWillUnmount, useEffect, mount, xml } = owl;

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

            <div class="sm-chart-card">
                <div class="sm-chart-header"><i class="fa fa-bar-chart"/> Aktivitas Survey 7 Hari Terakhir</div>
                <div class="sm-chart-canvas" t-ref="weeklyChart"/>
            </div>

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

                confirmLogout: false,
            });

            onMounted(() => {
                this._loadKpi();
                this._loadWeeklyChart();
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
            return { dpt_id: null, dpt_name: '', pilihan: '', fotoBase64: null, fotoPreview: null };
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
            }[this.state.subpage] || '';
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

        // ── Toast ──────────────────────────────────────────────────────────
        toast(text, type = 'info') {
            this.state.toast = { show: true, text, type };
            clearTimeout(this._toastTimer);
            this._toastTimer = setTimeout(() => { this.state.toast.show = false; }, 3200);
        }

        // ── Navigasi ───────────────────────────────────────────────────────
        switchTab(tab) {
            this.state.tab = tab;
            this.state.subpage = null;
            if (tab === 'home') {
                this._loadKpi();
                this._loadWeeklyChart();
            }
            if (tab === 'dpt' && !this.state.dptList.length) this._loadDptList(true);
            if (tab === 'survey' && !this.state.surveyList.length) this._loadSurveyList(true);
        }
        closeSubpage() {
            const wasSubpage = this.state.subpage;
            this.state.subpage = null;
            if (wasSubpage === 'dpt-detail' || wasSubpage === 'dpt-add') this._loadDptList(true);
            if (wasSubpage === 'survey-add') this._loadSurveyList(true);
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
        logout() { window.location.href = '/smartpolling/logout'; }

        // ── KPI ────────────────────────────────────────────────────────────
        async _loadKpi() {
            try {
                const res = await rpc('/smartpolling/api/kpi', {});
                if (res.error) return;
                this.state.kpi = res;
            } catch (e) { console.error(e); }
        }

        async _loadWeeklyChart() {
            try {
                const res = await rpc('/smartpolling/api/weekly', {});
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
                const res = await rpc('/smartpolling/api/dpt/list', Object.assign({
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
            this.state.subpage = 'dpt-detail';
            this.state.dptDetail = null;
            this.state.dptDetailLoading = true;
            try {
                const res = await rpc('/smartpolling/api/dpt/record', { dpt_id: id });
                if (res.error) { this.toast('Gagal memuat detail DPT', 'error'); this.state.subpage = null; return; }
                this.state.dptDetail = res;
            } catch (e) {
                this.toast('Gagal memuat detail DPT', 'error');
                this.state.subpage = null;
            } finally {
                this.state.dptDetailLoading = false;
            }
        }
        // ── DPT add ────────────────────────────────────────────────────────
        openDptAdd() {
            this.state.dptForm = this._emptyDptForm();
            this.state.gpsAccuracy = null;
            this.state.subpage = 'dpt-add';
        }
        async _loadTpsOptions() {
            try {
                const res = await rpc('/smartpolling/api/dpt/tps_options', {});
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
                const res = await rpc('/smartpolling/api/dpt/create', { data: f });
                if (res.error) return this.toast(res.error, 'error');
                this.toast('DPT berhasil ditambahkan', 'success');
                this.state.subpage = null;
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
                const res = await rpc('/smartpolling/api/survey/list', {
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
        openSurveyAddFor(dptId, dptName) {
            this.state.surveyForm = dptId
                ? { dpt_id: dptId, dpt_name: dptName, pilihan: '', fotoBase64: null, fotoPreview: null }
                : this._emptySurveyForm();
            this.state.dptPickSearch = '';
            this.state.dptPickResults = [];
            this.state.subpage = 'survey-add';
        }
        onDptPickSearchKey() {
            clearTimeout(this._pickTimer);
            const q = this.state.dptPickSearch;
            if (!q || q.length < 2) { this.state.dptPickResults = []; return; }
            this._pickTimer = setTimeout(async () => {
                this.state.dptPickLoading = true;
                try {
                    const res = await rpc('/smartpolling/api/dpt/list', { offset: 0, limit: 10, search: q });
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
                const res = await rpc('/smartpolling/api/survey/create', {
                    dpt_id: f.dpt_id, pilihan: f.pilihan, foto: f.fotoBase64 || null,
                });
                if (res.error) return this.toast(res.error, 'error');
                this.toast('Survey berhasil disimpan', 'success');
                this.state.subpage = null;
                this.state.tab = 'survey';
                this._loadSurveyList(true);
                this._loadKpi();
            } catch (e) {
                this.toast('Gagal menyimpan survey', 'error');
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
                const res = await rpc('/smartpolling/api/profile/update_photo', { foto: dataUrl.split(',')[1] });
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
