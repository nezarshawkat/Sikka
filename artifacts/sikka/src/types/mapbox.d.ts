declare module 'react-map-gl' {
  import { ComponentType, ReactNode } from 'react';

  export interface ViewState {
    latitude: number;
    longitude: number;
    zoom: number;
    bearing?: number;
    pitch?: number;
  }

  export interface MapProps {
    mapboxAccessToken?: string;
    mapStyle?: string;
    style?: React.CSSProperties;
    initialViewState?: Partial<ViewState>;
    latitude?: number;
    longitude?: number;
    zoom?: number;
    onMove?: (evt: { viewState: ViewState }) => void;
    children?: ReactNode;
    [key: string]: any;
  }

  export interface MarkerProps {
    latitude: number;
    longitude: number;
    children?: ReactNode;
    [key: string]: any;
  }

  const Map: ComponentType<MapProps>;
  export const Marker: ComponentType<MarkerProps>;
  export const GeolocateControl: ComponentType<any>;
  export const NavigationControl: ComponentType<any>;
  export const Source: ComponentType<any>;
  export const Layer: ComponentType<any>;
  export default Map;
}

declare module 'mapbox-gl/dist/mapbox-gl.css';
declare module 'maplibre-gl/dist/maplibre-gl.css';
