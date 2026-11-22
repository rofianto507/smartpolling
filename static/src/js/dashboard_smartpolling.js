/** @odoo-module **/

import { Component, onMounted, onWillUnmount, useRef } from "@odoo/owl";
import { registry } from "@web/core/registry";
import { useService } from "@web/core/utils/hooks";

// ─────────────────────────────────────────────────────────────────────────────
// Skala warna choropleth — dinamis mengikuti jumlah DPT tertinggi pada level
// wilayah yang sedang ditampilkan (bukan threshold tetap), supaya tetap
// bermakna baik untuk kampanye skala kabupaten maupun provinsi.
// ─────────────────────────────────────────────────────────────────────────────
function getChoroplethColor(count, maxCount) {
    if (!count) return '#EBF5FB';
    if (!maxCount) return '#AED6F1';
    const ratio = count / maxCount;
    if (ratio <= 0.2) return '#AED6F1';
    if (ratio <= 0.4) return '#5DADE2';
    if (ratio <= 0.7) return '#2874A6';
    return '#1B4F72';
}

// Rentang jumlah per bucket harus persis mengikuti batas rasio di getChoroplethColor
// di atas (pakai floor, bukan round, supaya konsisten dgn pembanding "ratio <= X").
function buildDensityBuckets(maxCount) {
    const fmt = (n) => n.toLocaleString('id-ID');
    if (!maxCount) {
        return [{ color: '#EBF5FB', label: 'Tidak ada', range: '0' }];
    }
    const rendahMax = Math.floor(0.2 * maxCount);
    const sedangMax = Math.floor(0.4 * maxCount);
    const tinggiMax = Math.floor(0.7 * maxCount);
    const raw = [
        { color: '#EBF5FB', label: 'Tidak ada', min: 0, max: 0 },
        { color: '#AED6F1', label: 'Rendah', min: 1, max: rendahMax },
        { color: '#5DADE2', label: 'Sedang', min: rendahMax + 1, max: sedangMax },
        { color: '#2874A6', label: 'Tinggi', min: sedangMax + 1, max: tinggiMax },
        { color: '#1B4F72', label: 'Tertinggi', min: tinggiMax + 1, max: maxCount },
    ];
    return raw
        .filter((b) => b.max >= b.min)
        .map((b) => ({
            color: b.color,
            label: b.label,
            range: b.min === b.max ? fmt(b.min) : `${fmt(b.min)}–${fmt(b.max)}`,
        }));
}

const STATE_COLORS = {
    baru: '#3498DB',
    terverifikasi: '#27AE60',
    ditolak: '#E74C3C',
};
const STATE_LABELS = {
    baru: 'Baru',
    terverifikasi: 'Terverifikasi',
    ditolak: 'Ditolak',
};

const PILIHAN_COLORS = {
    memilih: '#27AE60',
    ragu_ragu: '#F39C12',
    belum_menentukan: '#7F8C8D',
    tidak_memilih: '#E74C3C',
};
const PILIHAN_LABELS = {
    memilih: 'Memilih',
    ragu_ragu: 'Ragu-ragu',
    belum_menentukan: 'Belum Menentukan',
    tidak_memilih: 'Tidak Memilih',
};

export class SmartPollingDashboard extends Component {
    static template = "smartpolling.Dashboard";
    static props = ["*"];

    setup() {
        this.mapWrapperRef   = useRef("mapWrapper");
        this.mapContainerRef = useRef("mapContainer");
        this.kpiRowUtamaRef    = useRef("kpiRowUtama");
        this.legendDensityRef  = useRef("legendDensity");
        this.chartPilihanRef   = useRef("chartPilihan");
        this.chartPetugasRef   = useRef("chartPetugas");
        this.chartWeeklyRef    = useRef("chartWeekly");

        this.orm    = useService("orm");
        this.action = useService("action");

        this.map = null;
        this.backButton = null;

        this._onWindowResize = () => {
            this._pilihanChart?.resize();
            this._petugasChart?.resize();
            this._weeklyChart?.resize();
        };

        onMounted(async () => {
            this._initMap();
            window.addEventListener('resize', this._onWindowResize);
            await Promise.all([
                this._loadKpis(),
                this._loadKabupatenChoropleth(),
                this._loadCharts(),
            ]);
        });

        onWillUnmount(() => {
            window.removeEventListener('resize', this._onWindowResize);
            this._pilihanChart?.dispose();
            this._petugasChart?.dispose();
            this._weeklyChart?.dispose();
        });
    }

    // ─────────────────────────────────────────────
    // MAP INIT
    // ─────────────────────────────────────────────
    _initMap() {
        const el = this.mapContainerRef.el;
        if (!el) return;

        this.map = L.map(el).setView([-2.5, 117.5], 5);
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        }).addTo(this.map);

        this.wilayahLayerGroup = L.layerGroup().addTo(this.map);
        this.wilayahLabelGroup = L.layerGroup().addTo(this.map);
        this.markerLayerGroup = L.markerClusterGroup({
            chunkedLoading: true,
            chunkInterval: 150,
            chunkSize: 100,
            maxClusterRadius: 70,
            showCoverageOnHover: false,
            spiderfyOnMaxZoom: true,
            disableClusteringAtZoom: 15,
            iconCreateFunction: (cluster) => {
                const count = cluster.getChildCount();
                let size;
                if (count < 10) size = 32;
                else if (count < 100) size = 40;
                else if (count < 1000) size = 48;
                else size = 56;
                const label = count >= 1000
                    ? (count >= 10000 ? Math.floor(count / 1000) + 'K+' : (count / 1000).toFixed(1) + 'K')
                    : count;
                return L.divIcon({
                    html: `<div class="smartpolling-cluster-icon" style="width:${size}px;height:${size}px;">${label}</div>`,
                    className: '',
                    iconSize: L.point(size, size),
                    iconAnchor: L.point(size / 2, size / 2),
                });
            },
        }).addTo(this.map);

        const ExpandControl = L.Control.extend({
            options: { position: 'topleft' },
            onAdd: () => {
                const container = L.DomUtil.create('div', 'leaflet-bar leaflet-control smartpolling-map-expand-btn');
                const a = L.DomUtil.create('a', '', container);
                a.href = '#';
                a.title = 'Perbesar Peta';
                a.setAttribute('role', 'button');
                a.innerHTML = '<i class="fa fa-expand"></i>';
                L.DomEvent.disableClickPropagation(container);
                L.DomEvent.on(a, 'click', (e) => {
                    L.DomEvent.preventDefault(e);
                    const wrapper = this.mapWrapperRef?.el;
                    if (!wrapper) return;
                    const expanded = wrapper.classList.toggle('smartpolling-map-wrapper--expanded');
                    a.title = expanded ? 'Kembalikan Ukuran' : 'Perbesar Peta';
                    a.innerHTML = expanded ? '<i class="fa fa-compress"></i>' : '<i class="fa fa-expand"></i>';
                    setTimeout(() => this.map.invalidateSize(), 50);
                });
                return container;
            },
        });
        new ExpandControl().addTo(this.map);
    }

    _renderDensityLegend(maxCount) {
        const el = this.legendDensityRef?.el;
        if (!el) return;
        el.innerHTML = buildDensityBuckets(maxCount).map((b) => `
            <span class="smartpolling-legend-swatch"><span class="smartpolling-legend-dot" style="background:${b.color};"></span> ${b.label} (${b.range})</span>
        `).join('');
    }

    _addBackButton(onBack, label = 'Kembali ke Peta Kabupaten') {
        if (this.backButton) { this.backButton.remove(); this.backButton = null; }
        const BackControl = L.Control.extend({
            options: { position: 'topleft' },
            onAdd: () => {
                const btn = L.DomUtil.create('button', 'smartpolling-btn-back');
                btn.innerHTML = `<i class="fa fa-arrow-left"></i> ${label}`;
                L.DomEvent.on(btn, 'click', async (ev) => {
                    L.DomEvent.stopPropagation(ev);
                    this.map.closePopup();
                    if (this.backButton) { this.backButton.remove(); this.backButton = null; }
                    await onBack();
                });
                return btn;
            },
        });
        this.backButton = new BackControl();
        this.backButton.addTo(this.map);
    }

    // ─────────────────────────────────────────────
    // CHOROPLETH — LEVEL KABUPATEN
    // ─────────────────────────────────────────────
    async _loadKabupatenChoropleth() {
        this.wilayahLayerGroup.clearLayers();
        this.wilayahLabelGroup.clearLayers();
        if (this.backButton) { this.backButton.remove(); this.backButton = null; }

        let records;
        try {
            records = await this.orm.searchRead(
                'smartpolling.kabupaten', [], ['id', 'code', 'name', 'type', 'geometry']);
        } catch (e) {
            console.error('Gagal memuat data kabupaten:', e);
            return;
        }
        if (!records.length) return;

        const counts = await Promise.all(records.map(r =>
            this.orm.searchCount('smartpolling.dpt', [['kabupaten_id', '=', r.id]])));
        const countMap = {};
        records.forEach((r, i) => { countMap[r.id] = counts[i]; });
        const maxCount = Math.max(0, ...counts);
        this._renderDensityLegend(maxCount);

        const features = records
            .filter(r => r.geometry)
            .map(r => {
                try {
                    return {
                        type: 'Feature',
                        geometry: JSON.parse(r.geometry),
                        properties: {
                            id: r.id, code: r.code, name: r.name, type: r.type,
                            jumlah_dpt: countMap[r.id] || 0,
                        },
                    };
                } catch (e) {
                    console.warn(`Gagal parse geometry kabupaten: ${r.name}`, e);
                    return null;
                }
            })
            .filter(Boolean);
        if (!features.length) return;

        const geoLayer = L.geoJSON({ type: 'FeatureCollection', features }, {
            style: (f) => {
                const color = getChoroplethColor(f.properties.jumlah_dpt, maxCount);
                return { color: '#888888', weight: 1.5, opacity: 1, fillColor: color, fillOpacity: 0.6 };
            },
            onEachFeature: (feature, layer) => {
                const props = feature.properties;
                layer.on('add', () => {
                    const bounds = layer.getBounds();
                    const label = L.marker(bounds.getCenter(), {
                        icon: L.divIcon({
                            className: 'smartpolling-wilayah-label',
                            html: `<span>${props.name}</span>`,
                            iconSize: null,
                        }),
                        interactive: false,
                        zIndexOffset: -100,
                    });
                    this.wilayahLabelGroup.addLayer(label);
                });
                layer.on('mouseover', () => layer.setStyle({ weight: 2.5, color: '#2c3e50' }));
                layer.on('mouseout', () => layer.setStyle({ weight: 1.5, color: '#888888' }));
                layer.on('click', (e) => this._showKabupatenPopup(e, props));
            },
        });

        this.wilayahLayerGroup.addLayer(geoLayer);
        this.map.fitBounds(geoLayer.getBounds());
        this._loadDptMarkers();
    }

    _showKabupatenPopup(e, props) {
        const tipeLabel = props.type === 'KOTA' ? 'Kota' : 'Kabupaten';
        const content = `
            <div class="smartpolling-popup">
                <div class="smartpolling-popup-header">
                    <i class="fa fa-map-marker"></i>
                    <strong>${tipeLabel} ${props.name}</strong>
                </div>
                <div class="smartpolling-popup-body">
                    <table>
                        <tr><td><i class="fa fa-barcode"></i> Kode</td><td><strong>${props.code}</strong></td></tr>
                        <tr><td><i class="fa fa-users"></i> Total DPT</td><td><strong>${props.jumlah_dpt.toLocaleString('id-ID')}</strong></td></tr>
                    </table>
                </div>
                <div class="smartpolling-popup-footer">
                    <button class="smartpolling-btn-detail" id="sp-btn-drill-${props.id}">
                        <i class="fa fa-search-plus"></i> Lihat Detail Kecamatan
                    </button>
                </div>
            </div>
        `;
        const popup = L.popup({ maxWidth: 260, className: 'smartpolling-leaflet-popup' })
            .setLatLng(e.latlng)
            .setContent(content);

        popup.once('add', () => {
            setTimeout(() => {
                const btn = document.getElementById(`sp-btn-drill-${props.id}`);
                if (btn) {
                    btn.addEventListener('click', () => {
                        this.map.closePopup();
                        this._drillDownKecamatan(props);
                    });
                }
            }, 0);
        });
        popup.openOn(this.map);
    }

    // ─────────────────────────────────────────────
    // CHOROPLETH — LEVEL KECAMATAN (drill-down)
    // ─────────────────────────────────────────────
    async _drillDownKecamatan(kabProps) {
        this.wilayahLayerGroup.clearLayers();
        this.wilayahLabelGroup.clearLayers();

        let records;
        try {
            records = await this.orm.searchRead(
                'smartpolling.kecamatan',
                [['kabupaten_id', '=', kabProps.id]],
                ['id', 'code', 'name', 'geometry']);
        } catch (e) {
            console.error('Gagal memuat data kecamatan:', e);
            return;
        }
        if (!records.length) {
            await this._loadKabupatenChoropleth();
            return;
        }

        const counts = await Promise.all(records.map(r =>
            this.orm.searchCount('smartpolling.dpt', [['kecamatan_id', '=', r.id]])));
        const countMap = {};
        records.forEach((r, i) => { countMap[r.id] = counts[i]; });
        const maxCount = Math.max(0, ...counts);
        this._renderDensityLegend(maxCount);

        const features = records
            .filter(r => r.geometry)
            .map(r => {
                try {
                    return {
                        type: 'Feature',
                        geometry: JSON.parse(r.geometry),
                        properties: { id: r.id, code: r.code, name: r.name, jumlah_dpt: countMap[r.id] || 0 },
                    };
                } catch (e) {
                    console.warn(`Gagal parse geometry kecamatan: ${r.name}`, e);
                    return null;
                }
            })
            .filter(Boolean);

        if (!features.length) {
            await this._loadKabupatenChoropleth();
            return;
        }

        const geoLayer = L.geoJSON({ type: 'FeatureCollection', features }, {
            style: (f) => {
                const color = getChoroplethColor(f.properties.jumlah_dpt, maxCount);
                return { color: '#888888', weight: 1.5, opacity: 1, fillColor: color, fillOpacity: 0.6 };
            },
            onEachFeature: (feature, layer) => {
                const props = feature.properties;
                layer.on('add', () => {
                    const bounds = layer.getBounds();
                    const label = L.marker(bounds.getCenter(), {
                        icon: L.divIcon({
                            className: 'smartpolling-wilayah-label',
                            html: `<span>${props.name}</span>`,
                            iconSize: null,
                        }),
                        interactive: false,
                        zIndexOffset: -100,
                    });
                    this.wilayahLabelGroup.addLayer(label);
                });
                layer.on('mouseover', () => layer.setStyle({ weight: 2.5, color: '#2c3e50' }));
                layer.on('mouseout', () => layer.setStyle({ weight: 1.5, color: '#888888' }));
                layer.on('click', (e) => this._showKecamatanPopup(e, props, kabProps));
            },
        });

        this.wilayahLayerGroup.addLayer(geoLayer);
        this.map.fitBounds(geoLayer.getBounds(), { padding: [40, 40] });
        this._loadDptMarkers([['kabupaten_id', '=', kabProps.id]]);
        this._addBackButton(async () => {
            await this._loadKabupatenChoropleth();
        }, 'Kembali ke Peta Kabupaten');
    }

    _showKecamatanPopup(e, props, kabProps) {
        const content = `
            <div class="smartpolling-popup">
                <div class="smartpolling-popup-header smartpolling-popup-header--kecamatan">
                    <i class="fa fa-map-marker"></i>
                    <strong>Kecamatan ${props.name}</strong>
                </div>
                <div class="smartpolling-popup-body">
                    <table>
                        <tr><td><i class="fa fa-barcode"></i> Kode</td><td><strong>${props.code}</strong></td></tr>
                        <tr><td><i class="fa fa-users"></i> Total DPT</td><td><strong>${props.jumlah_dpt.toLocaleString('id-ID')}</strong></td></tr>
                    </table>
                </div>
                <div class="smartpolling-popup-footer">
                    <button class="smartpolling-btn-detail" id="sp-btn-drill-desa-${props.id}">
                        <i class="fa fa-search-plus"></i> Lihat Detail Desa/Kelurahan
                    </button>
                </div>
            </div>
        `;
        const popup = L.popup({ maxWidth: 260, className: 'smartpolling-leaflet-popup' })
            .setLatLng(e.latlng)
            .setContent(content);

        popup.once('add', () => {
            setTimeout(() => {
                const btn = document.getElementById(`sp-btn-drill-desa-${props.id}`);
                if (btn) {
                    btn.addEventListener('click', () => {
                        this.map.closePopup();
                        this._drillDownDesa(props, kabProps);
                    });
                }
            }, 0);
        });
        popup.openOn(this.map);
    }

    // ─────────────────────────────────────────────
    // CHOROPLETH — LEVEL DESA/KELURAHAN (drill-down)
    // ─────────────────────────────────────────────
    async _drillDownDesa(kecProps, kabProps) {
        this.wilayahLayerGroup.clearLayers();
        this.wilayahLabelGroup.clearLayers();

        let records;
        try {
            records = await this.orm.searchRead(
                'smartpolling.desa',
                [['kecamatan_id', '=', kecProps.id]],
                ['id', 'code', 'name', 'type', 'geometry', 'tps_count']);
        } catch (e) {
            console.error('Gagal memuat data desa/kelurahan:', e);
            return;
        }
        if (!records.length) {
            await this._drillDownKecamatan(kabProps);
            return;
        }

        const counts = await Promise.all(records.map(r =>
            this.orm.searchCount('smartpolling.dpt', [['tps_id.desa_id', '=', r.id]])));
        const countMap = {};
        records.forEach((r, i) => { countMap[r.id] = counts[i]; });
        const maxCount = Math.max(0, ...counts);
        this._renderDensityLegend(maxCount);

        const features = records
            .filter(r => r.geometry)
            .map(r => {
                try {
                    return {
                        type: 'Feature',
                        geometry: JSON.parse(r.geometry),
                        properties: {
                            id: r.id, code: r.code, name: r.name, type: r.type,
                            jumlah_dpt: countMap[r.id] || 0, tps_count: r.tps_count || 0,
                        },
                    };
                } catch (e) {
                    console.warn(`Gagal parse geometry desa: ${r.name}`, e);
                    return null;
                }
            })
            .filter(Boolean);

        if (!features.length) {
            await this._drillDownKecamatan(kabProps);
            return;
        }

        const geoLayer = L.geoJSON({ type: 'FeatureCollection', features }, {
            style: (f) => {
                const color = getChoroplethColor(f.properties.jumlah_dpt, maxCount);
                return { color: '#888888', weight: 1.5, opacity: 1, fillColor: color, fillOpacity: 0.6 };
            },
            onEachFeature: (feature, layer) => {
                const props = feature.properties;
                layer.on('add', () => {
                    const bounds = layer.getBounds();
                    const label = L.marker(bounds.getCenter(), {
                        icon: L.divIcon({
                            className: 'smartpolling-wilayah-label',
                            html: `<span>${props.name}</span>`,
                            iconSize: null,
                        }),
                        interactive: false,
                        zIndexOffset: -100,
                    });
                    this.wilayahLabelGroup.addLayer(label);
                });
                layer.on('mouseover', () => layer.setStyle({ weight: 2.5, color: '#2c3e50' }));
                layer.on('mouseout', () => layer.setStyle({ weight: 1.5, color: '#888888' }));
                layer.on('click', (e) => this._showDesaPopup(e, props));
            },
        });

        this.wilayahLayerGroup.addLayer(geoLayer);
        this.map.fitBounds(geoLayer.getBounds(), { padding: [40, 40] });
        this._loadDptMarkers([['kecamatan_id', '=', kecProps.id]]);
        this._addBackButton(async () => {
            await this._drillDownKecamatan(kabProps);
        }, 'Kembali ke Peta Kecamatan');
    }

    _showDesaPopup(e, props) {
        const tipeLabel = props.type === 'KELURAHAN' ? 'Kelurahan' : 'Desa';
        const content = `
            <div class="smartpolling-popup">
                <div class="smartpolling-popup-header" style="background:#16A085;">
                    <i class="fa fa-map-marker"></i>
                    <strong>${tipeLabel} ${props.name}</strong>
                </div>
                <div class="smartpolling-popup-body">
                    <table>
                        <tr><td><i class="fa fa-barcode"></i> Kode</td><td><strong>${props.code}</strong></td></tr>
                        <tr><td><i class="fa fa-users"></i> Total DPT</td><td><strong>${props.jumlah_dpt.toLocaleString('id-ID')}</strong></td></tr>
                        <tr><td><i class="fa fa-building"></i> Total TPS</td><td><strong>${props.tps_count.toLocaleString('id-ID')}</strong></td></tr>
                    </table>
                </div>
                <div class="smartpolling-popup-footer">
                    <button class="smartpolling-btn-detail" id="sp-btn-desa-tps-${props.id}">
                        <i class="fa fa-list"></i> Lihat Daftar TPS
                    </button>
                </div>
            </div>
        `;
        const popup = L.popup({ maxWidth: 260, className: 'smartpolling-leaflet-popup' })
            .setLatLng(e.latlng)
            .setContent(content);

        popup.once('add', () => {
            setTimeout(() => {
                const btn = document.getElementById(`sp-btn-desa-tps-${props.id}`);
                if (btn) {
                    btn.addEventListener('click', () => {
                        this.action.doAction({
                            type: 'ir.actions.act_window',
                            name: `TPS — ${props.name}`,
                            res_model: 'smartpolling.tps',
                            view_mode: 'list,form',
                            views: [[false, 'list'], [false, 'form']],
                            domain: [['desa_id', '=', props.id]],
                            target: 'current',
                        });
                    });
                }
            }, 0);
        });
        popup.openOn(this.map);
    }

    // ─────────────────────────────────────────────
    // MARKER TITIK DPT
    // ─────────────────────────────────────────────
    async _loadDptMarkers(extraDomain = []) {
        // Token permintaan supaya respons yang telat dari drill-down sebelumnya
        // tidak menimpa marker level yang sedang aktif sekarang (race condition).
        const requestToken = (this._markersRequestToken = (this._markersRequestToken || 0) + 1);

        let records;
        try {
            records = await this.orm.searchRead(
                'smartpolling.dpt',
                [['latitude', '!=', 0], ['longitude', '!=', 0], ...extraDomain],
                ['id', 'nama', 'nik', 'state', 'tps_id', 'latitude', 'longitude'],
                { limit: 20000 });
        } catch (e) {
            console.error('Gagal memuat titik DPT:', e);
            return;
        }

        if (requestToken !== this._markersRequestToken) return;
        this.markerLayerGroup.clearLayers();

        records.forEach((r) => {
            const color = STATE_COLORS[r.state] || '#7F8C8D';
            const icon = L.divIcon({
                className: '',
                html: `<div class="smartpolling-dpt-marker" style="border-color:${color};"><i class="fa fa-user" style="color:${color};"></i></div>`,
                iconSize: [20, 20],
                iconAnchor: [10, 10],
            });
            const marker = L.marker([r.latitude, r.longitude], { icon });
            const tpsName = r.tps_id ? r.tps_id[1] : '-';
            const stateLabel = STATE_LABELS[r.state] || r.state;
            const content = `
                <div class="smartpolling-popup">
                    <div class="smartpolling-popup-header" style="background:${color};">
                        <i class="fa fa-user"></i>
                        <strong>${r.nama}</strong>
                    </div>
                    <div class="smartpolling-popup-body">
                        <table>
                            <tr><td><i class="fa fa-id-card"></i> NIK</td><td>${r.nik}</td></tr>
                            <tr><td><i class="fa fa-building"></i> TPS</td><td>${tpsName}</td></tr>
                            <tr><td><i class="fa fa-flag"></i> Status</td><td>${stateLabel}</td></tr>
                        </table>
                    </div>
                    <div class="smartpolling-popup-footer">
                        <button class="smartpolling-btn-detail" id="sp-btn-dpt-${r.id}">
                            <i class="fa fa-search"></i> Lihat Detail
                        </button>
                    </div>
                </div>
            `;
            marker.bindPopup(content, { maxWidth: 280, className: 'smartpolling-leaflet-popup' });
            marker.on('popupopen', () => {
                setTimeout(() => {
                    const btn = document.getElementById(`sp-btn-dpt-${r.id}`);
                    if (btn) {
                        btn.addEventListener('click', () => {
                            this.action.doAction({
                                type: 'ir.actions.act_window',
                                res_model: 'smartpolling.dpt',
                                res_id: r.id,
                                views: [[false, 'form']],
                                target: 'current',
                            });
                        });
                    }
                }, 0);
            });
            this.markerLayerGroup.addLayer(marker);
        });
    }

    // ─────────────────────────────────────────────
    // KPI CARDS
    // ─────────────────────────────────────────────
    _renderKpiRow(rowEl, cards) {
        if (!rowEl) return;
        rowEl.setAttribute('data-cols', cards.length);
        rowEl.innerHTML = cards.map((c, i) => `
            <div class="smartpolling-kpi-card${c.domain ? ' smartpolling-kpi-card--clickable' : ''}" data-idx="${i}">
                <div class="smartpolling-kpi-icon" style="color:${c.color};">
                    <i class="fa ${c.icon}"></i>
                </div>
                <div class="smartpolling-kpi-body">
                    <div class="smartpolling-kpi-value">${typeof c.value === 'number' ? c.value.toLocaleString('id-ID') : c.value}</div>
                    <div class="smartpolling-kpi-label">${c.label}</div>
                </div>
            </div>
        `).join('');
        rowEl.querySelectorAll('.smartpolling-kpi-card--clickable').forEach((cardEl) => {
            cardEl.addEventListener('click', () => {
                const card = cards[parseInt(cardEl.dataset.idx, 10)];
                if (!card || !card.model) return;
                this.action.doAction({
                    type: 'ir.actions.act_window',
                    name: card.label,
                    res_model: card.model,
                    view_mode: 'list,form',
                    views: [[false, 'list'], [false, 'form']],
                    domain: card.domain || [],
                    target: 'current',
                });
            });
        });
    }

    async _loadKpis() {
        const [
            totalDpt,
            tpsAgg,
            relawanAktif,
            tpsAktif,
        ] = await Promise.all([
            this.orm.searchCount('smartpolling.dpt', []),
            this.orm.searchRead('smartpolling.tps', [], ['total_dpt', 'total_target'], { limit: 20000 }),
            this.orm.searchCount('smartpolling.relawan', [['state', '=', 'aktif']]),
            this.orm.searchCount('smartpolling.tps', [['state', '=', 'aktif']]),
        ]);

        const sumTarget = tpsAgg.reduce((s, r) => s + (r.total_target || 0), 0);
        const sumRealisasi = tpsAgg.reduce((s, r) => s + (r.total_dpt || 0), 0);
        const persenCapaian = sumTarget > 0 ? Math.round((sumRealisasi / sumTarget) * 100) : 0;

        this._renderKpiRow(this.kpiRowUtamaRef.el, [
            { icon: 'fa-users', color: '#2874A6', value: totalDpt, label: 'Total DPT Terdata', model: 'smartpolling.dpt', domain: [] },
            { icon: 'fa-bullseye', color: persenCapaian >= 100 ? '#27AE60' : '#F39C12', value: `${persenCapaian}%`, label: 'Capaian vs Target DPT', model: 'smartpolling.tps', domain: [] },
            { icon: 'fa-user', color: '#8E44AD', value: relawanAktif, label: 'Relawan Aktif', model: 'smartpolling.relawan', domain: [['state', '=', 'aktif']] },
            { icon: 'fa-building', color: '#16A085', value: tpsAktif, label: 'TPS Aktif', model: 'smartpolling.tps', domain: [['state', '=', 'aktif']] },
        ]);
    }

    // ─────────────────────────────────────────────
    // CHART — STATISTIK SURVEY (ECharts)
    // ─────────────────────────────────────────────
    async _loadCharts() {
        await Promise.all([
            this._renderPilihanChart(),
            this._renderPetugasChart(),
            this._renderWeeklyChart(),
        ]);
    }

    _emptyChartOption(text) {
        return {
            graphic: [{
                type: 'text', left: 'center', top: 'middle',
                style: { text, fill: '#9ca3af', fontSize: 13 },
            }],
        };
    }

    async _renderPilihanChart() {
        const el = this.chartPilihanRef?.el;
        if (!el || typeof echarts === 'undefined') return;

        let groups;
        try {
            groups = await this.orm.formattedReadGroup('smartpolling.voter', [], ['pilihan'], ['__count']);
        } catch (e) {
            console.error('Gagal memuat data pilihan voter:', e);
            return;
        }

        if (this._pilihanChart) this._pilihanChart.dispose();
        this._pilihanChart = echarts.init(el);

        const data = groups
            .filter((g) => g.pilihan)
            .map((g) => ({
                name: PILIHAN_LABELS[g.pilihan] || g.pilihan,
                value: g.__count,
                itemStyle: { color: PILIHAN_COLORS[g.pilihan] || '#95A5A6' },
            }));

        if (!data.length) {
            this._pilihanChart.setOption(this._emptyChartOption('Belum ada data survey'));
            return;
        }

        this._pilihanChart.setOption({
            tooltip: { trigger: 'item', formatter: '{b}: {c} ({d}%)' },
            legend: { bottom: 0, textStyle: { fontSize: 11, color: '#6b7280' } },
            series: [{
                type: 'pie',
                radius: ['45%', '70%'],
                center: ['50%', '45%'],
                label: { show: false },
                labelLine: { show: false },
                itemStyle: { borderColor: '#fff', borderWidth: 2 },
                data,
            }],
        });
    }

    async _renderPetugasChart() {
        const el = this.chartPetugasRef?.el;
        if (!el || typeof echarts === 'undefined') return;

        let groups;
        try {
            groups = await this.orm.formattedReadGroup(
                'smartpolling.voter', [], ['petugas_id', 'pilihan'], ['__count']);
        } catch (e) {
            console.error('Gagal memuat data survey per petugas:', e);
            return;
        }

        if (this._petugasChart) this._petugasChart.dispose();
        this._petugasChart = echarts.init(el);

        const rows = groups.filter((g) => g.petugas_id);
        if (!rows.length) {
            this._petugasChart.setOption(this._emptyChartOption('Belum ada data survey'));
            return;
        }

        const petugasNames = new Map();
        rows.forEach((g) => petugasNames.set(g.petugas_id[0], g.petugas_id[1]));
        const petugasIds = [...petugasNames.keys()]
            .sort((a, b) => petugasNames.get(a).localeCompare(petugasNames.get(b), 'id'));
        const labels = petugasIds.map((id) => petugasNames.get(id));

        const pilihanKeys = Object.keys(PILIHAN_LABELS);
        const series = pilihanKeys.map((key) => ({
            name: PILIHAN_LABELS[key],
            type: 'bar',
            stack: 'total',
            barMaxWidth: 24,
            itemStyle: { color: PILIHAN_COLORS[key] },
            data: petugasIds.map((id) => {
                const row = rows.find((g) => g.petugas_id[0] === id && g.pilihan === key);
                return row ? row.__count : 0;
            }),
        }));

        this._petugasChart.setOption({
            tooltip: {
                trigger: 'axis',
                axisPointer: { type: 'shadow' },
                backgroundColor: '#fff', borderColor: '#e5e7eb', borderWidth: 1,
                textStyle: { color: '#374151', fontSize: 12 },
            },
            legend: { bottom: 0, textStyle: { fontSize: 11, color: '#6b7280' } },
            grid: { left: 10, right: 16, top: 16, bottom: 90, containLabel: true },
            xAxis: {
                type: 'category', data: labels,
                axisLabel: { rotate: 35, fontSize: 11, color: '#6b7280' },
                axisLine: { lineStyle: { color: '#e5e7eb' } }, axisTick: { show: false },
            },
            yAxis: {
                type: 'value', minInterval: 1,
                axisLabel: { fontSize: 11, color: '#9ca3af' },
                splitLine: { lineStyle: { color: '#f3f4f6', type: 'dashed' } },
            },
            series,
        });
    }

    async _renderWeeklyChart() {
        const el = this.chartWeeklyRef?.el;
        if (!el || typeof echarts === 'undefined') return;

        const days = [];
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        for (let i = 29; i >= 0; i--) {
            const d = new Date(today);
            d.setDate(d.getDate() - i);
            days.push(d);
        }
        const BULAN = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
        const dayKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        const dayLabel = (d) => `${String(d.getDate()).padStart(2, '0')} ${BULAN[d.getMonth()]}`;

        let records;
        try {
            records = await this.orm.searchRead(
                'smartpolling.voter',
                [['tanggal', '>=', `${dayKey(days[0])} 00:00:00`]],
                ['tanggal'], { limit: 10000 });
        } catch (e) {
            console.error('Gagal memuat tren survey bulanan:', e);
            return;
        }

        if (this._weeklyChart) this._weeklyChart.dispose();
        this._weeklyChart = echarts.init(el);

        const counts = {};
        days.forEach((d) => { counts[dayKey(d)] = 0; });
        records.forEach((r) => {
            // tanggal disimpan UTC oleh Odoo; kelompokkan per hari kalender lokal browser
            const local = new Date(r.tanggal.replace(' ', 'T') + 'Z');
            const key = dayKey(local);
            if (key in counts) counts[key] += 1;
        });

        const labels = days.map(dayLabel);
        const values = days.map((d) => counts[dayKey(d)]);

        if (!values.some((v) => v > 0)) {
            this._weeklyChart.setOption(this._emptyChartOption('Belum ada survey 1 bulan terakhir'));
            return;
        }

        this._weeklyChart.setOption({
            tooltip: {
                trigger: 'axis', axisPointer: { type: 'cross' },
                backgroundColor: '#fff', borderColor: '#e5e7eb', borderWidth: 1,
                textStyle: { color: '#374151', fontSize: 12 },
                formatter: (p) => `${p[0].name}<br/><b>${p[0].value.toLocaleString('id-ID')} survey</b>`,
            },
            grid: { left: 10, right: 16, top: 16, bottom: 50, containLabel: true },
            xAxis: {
                type: 'category', data: labels, boundaryGap: false,
                axisLabel: { fontSize: 10, color: '#6b7280', rotate: 45 },
                axisLine: { lineStyle: { color: '#e5e7eb' } }, axisTick: { show: false },
            },
            yAxis: {
                type: 'value', minInterval: 1,
                axisLabel: { fontSize: 11, color: '#9ca3af' },
                splitLine: { lineStyle: { color: '#f3f4f6', type: 'dashed' } },
            },
            series: [{
                type: 'line', data: values,
                smooth: true, symbol: 'circle', symbolSize: 5,
                lineStyle: { color: '#714B67', width: 2.5 },
                itemStyle: { color: '#714B67', borderColor: '#fff', borderWidth: 2 },
                areaStyle: {
                    color: {
                        type: 'linear', x: 0, y: 0, x2: 0, y2: 1,
                        colorStops: [
                            { offset: 0, color: 'rgba(113,75,103,0.28)' },
                            { offset: 1, color: 'rgba(113,75,103,0.02)' },
                        ],
                    },
                },
            }],
        });
    }
}

registry.category("actions").add("smartpolling_dashboard", SmartPollingDashboard);
