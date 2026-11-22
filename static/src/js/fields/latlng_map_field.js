/** @odoo-module **/

import { registry } from "@web/core/registry";
import { standardFieldProps } from "@web/views/fields/standard_field_props";
import { Component, useRef, onMounted, onWillUnmount, onWillUpdateProps } from "@odoo/owl";

const DEFAULT_CENTER = [-2.5, 117.5];
const DEFAULT_ZOOM = 5;
const FOCUS_ZOOM = 16;

export class LatLngMapField extends Component {
    static template = "smartpolling.LatLngMapField";
    static props = {
        ...standardFieldProps,
        longitudeField: { type: String, optional: true },
    };

    setup() {
        this.mapContainerRef = useRef("latlngMapContainer");
        this.map = null;
        this.marker = null;

        onMounted(() => this._initMap());
        onWillUnmount(() => {
            if (this.map) {
                this.map.remove();
                this.map = null;
            }
        });
        onWillUpdateProps((nextProps) => {
            if (!this.map) return;
            const lat = nextProps.record.data[nextProps.name];
            const lng = nextProps.record.data[nextProps.longitudeField || 'longitude'];
            this._syncMarker(lat, lng);
        });
    }

    get longitudeFieldName() {
        return this.props.longitudeField || 'longitude';
    }

    _initMap() {
        const el = this.mapContainerRef.el;
        if (!el || typeof L === 'undefined') return;

        const lat = this.props.record.data[this.props.name];
        const lng = this.props.record.data[this.longitudeFieldName];
        const hasCoords = !!(lat || lng);

        this.map = L.map(el, { attributionControl: false })
            .setView(hasCoords ? [lat, lng] : DEFAULT_CENTER, hasCoords ? FOCUS_ZOOM : DEFAULT_ZOOM);

        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '&copy; OpenStreetMap',
        }).addTo(this.map);

        if (hasCoords) {
            this._placeMarker(lat, lng);
        }

        if (!this.props.readonly) {
            this.map.on('click', (e) => {
                this._placeMarker(e.latlng.lat, e.latlng.lng);
                this._updateFields(e.latlng.lat, e.latlng.lng);
                if (this.map.getZoom() < FOCUS_ZOOM) {
                    this.map.setView(e.latlng, FOCUS_ZOOM);
                }
            });
        }

        // container baru dimount, Leaflet perlu recalculate ukuran setelah layout stabil
        setTimeout(() => this.map && this.map.invalidateSize(), 100);
    }

    _placeMarker(lat, lng) {
        if (this.marker) {
            this.marker.setLatLng([lat, lng]);
            return;
        }
        this.marker = L.marker([lat, lng], { draggable: !this.props.readonly }).addTo(this.map);
        this.marker.on('dragend', () => {
            const pos = this.marker.getLatLng();
            this._updateFields(pos.lat, pos.lng);
        });
    }

    _updateFields(lat, lng) {
        this.props.record.update({
            [this.props.name]: Number(lat.toFixed(6)),
            [this.longitudeFieldName]: Number(lng.toFixed(6)),
        });
    }

    _syncMarker(lat, lng) {
        if (!(lat || lng)) return;
        if (this.marker) {
            const current = this.marker.getLatLng();
            if (Math.abs(current.lat - lat) > 1e-7 || Math.abs(current.lng - lng) > 1e-7) {
                this.marker.setLatLng([lat, lng]);
                this.map.panTo([lat, lng]);
            }
        } else {
            this._placeMarker(lat, lng);
            this.map.setView([lat, lng], FOCUS_ZOOM);
        }
    }
}

export const latLngMapField = {
    component: LatLngMapField,
    supportedTypes: ["float"],
    extractProps: ({ options }) => ({
        longitudeField: options.longitude_field,
    }),
};

registry.category("fields").add("smartpolling_latlng_map", latLngMapField);
