'use client';

import { useRef, useEffect, useCallback, useState, type CSSProperties } from 'react';
import AIRPORTS from '@/lib/airports';
import { feature } from 'topojson-client';
import { Detailer, detailerSlug, detailerPlace, detailerCoords as coordsFromDetailer, distanceMiles } from '@/lib/detailer';

const CRM_URL = process.env.NEXT_PUBLIC_CRM_URL || 'https://crm.shinyjets.com';

// Server coords first, then the hardcoded airport table as a fallback for
// older/cached API responses that predate server-side coordinate resolution.
function detailerCoords(d: Detailer): [number, number] | null {
  const server = coordsFromDetailer(d);
  if (server) return server;
  const coords = AIRPORTS[(d.home_airport || '').toUpperCase()];
  return coords || null;
}

interface Cluster {
  lat: number;
  lng: number;
  detailers: Detailer[];
}

const PLAN_TIER: Record<string, number> = { enterprise: 3, business: 2, pro: 1, free: 0 };

function sortByTier(detailers: Detailer[]): Detailer[] {
  return [...detailers].sort((a, b) => (PLAN_TIER[b.plan] || 0) - (PLAN_TIER[a.plan] || 0));
}

// Continuous cluster radius: close camera → 0 miles (only same-airport merges),
// far camera → up to 600 miles. So zooming in progressively de-clusters.
function clusterThresholdMiles(cameraZ: number): number {
  const t = Math.max(0, Math.min(1, (cameraZ - 1.5) / (5.5 - 1.5)));
  return t * 600;
}

function buildClusters(detailers: Detailer[], cameraZ: number): Cluster[] {
  const threshold = clusterThresholdMiles(cameraZ);
  const points: { lat: number; lng: number; detailer: Detailer }[] = [];
  for (const d of detailers) {
    const coords = detailerCoords(d);
    if (!coords) continue;
    points.push({ lat: coords[0], lng: coords[1], detailer: d });
  }

  const clusters: Cluster[] = [];
  const used = new Set<number>();

  for (let i = 0; i < points.length; i++) {
    if (used.has(i)) continue;
    const seed = points[i];
    const group: Detailer[] = [seed.detailer];
    used.add(i);
    let centerLat = seed.lat;
    let centerLng = seed.lng;
    for (let j = i + 1; j < points.length; j++) {
      if (used.has(j)) continue;
      const p = points[j];
      const dist = distanceMiles(centerLat, centerLng, p.lat, p.lng);
      if (dist <= threshold) {
        group.push(p.detailer);
        used.add(j);
        centerLat = (centerLat * (group.length - 1) + p.lat) / group.length;
        centerLng = (centerLng * (group.length - 1) + p.lng) / group.length;
      }
    }
    clusters.push({ lat: centerLat, lng: centerLng, detailers: group });
  }

  return clusters;
}

export interface GlobeFocus {
  lat: number;
  lng: number;
  code?: string;
}

interface GlobeProps {
  detailers: Detailer[];
  focus?: GlobeFocus | null;
  onReady?: () => void;
}

// Cached GeoJSON features so we only fetch once
let cachedFeatures: any[] | null = null;

async function loadCountries(): Promise<any[]> {
  if (cachedFeatures) return cachedFeatures;
  try {
    // Self-hosted (was cdn.jsdelivr.net, which the network policy can block).
    const res = await fetch('/countries-50m.json');
    if (!res.ok) return [];
    const topology = await res.json();
    const fc: any = feature(topology, topology.objects.countries);
    cachedFeatures = fc.features || [];
    return cachedFeatures || [];
  } catch (e) {
    console.error('[Globe] Failed to load countries topology:', e);
    return [];
  }
}

function lngLatToXY(lng: number, lat: number, w: number, h: number): [number, number] {
  const x = ((lng + 180) / 360) * w;
  const y = ((90 - lat) / 180) * h;
  return [x, y];
}

function drawRing(ctx: CanvasRenderingContext2D, ring: number[][], w: number, h: number) {
  if (ring.length === 0) return;
  ctx.beginPath();
  for (let i = 0; i < ring.length; i++) {
    const [lng, lat] = ring[i];
    const [x, y] = lngLatToXY(lng, lat, w, h);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
}

function drawGlobeTexture(features: any[]): HTMLCanvasElement {
  const w = 2048;
  const h = 1024;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = '#001f3f';
  ctx.fillRect(0, 0, w, h);

  ctx.fillStyle = '#253545';
  ctx.strokeStyle = 'rgba(100, 180, 255, 0.15)';
  ctx.lineWidth = 1.5;

  for (const f of features) {
    const geom = f.geometry;
    if (!geom) continue;
    if (geom.type === 'Polygon') {
      for (const ring of geom.coordinates) {
        drawRing(ctx, ring, w, h);
        ctx.fill();
        ctx.stroke();
      }
    } else if (geom.type === 'MultiPolygon') {
      for (const polygon of geom.coordinates) {
        for (const ring of polygon) {
          drawRing(ctx, ring, w, h);
          ctx.fill();
          ctx.stroke();
        }
      }
    }
  }

  ctx.fillStyle = 'rgba(255, 255, 255, 0.025)';
  for (let x = 0; x < w; x += 22) {
    for (let y = 0; y < h; y += 22) {
      ctx.beginPath();
      ctx.arc(x + (y / 22 % 2 === 0 ? 0 : 11), y, 1.2, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  return canvas;
}

// React state describing which card is open. Position is applied imperatively
// (see updateCardScreenPosition) so rotation/zoom don't thrash React.
type CardState =
  | { kind: 'single'; detailer: Detailer; sticky: boolean }
  | { kind: 'cluster'; detailers: Detailer[]; area: string; sticky: boolean }
  | null;

export default function Globe({ detailers, focus, onReady }: GlobeProps) {
  const mountRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<any>(null);
  const detailersRef = useRef(detailers);
  detailersRef.current = detailers;

  const [card, setCard] = useState<CardState>(null);
  const cardStickyRef = useRef(false);
  cardStickyRef.current = !!card?.sticky;
  // Card state mirrored to a ref so the animation loop (which can't read React
  // state) can anchor/hide the card each frame.
  const cardStateRef = useRef<CardState>(null);
  cardStateRef.current = card;
  // The pin group whose screen position the card is anchored to.
  const activeGroupRef = useRef<any>(null);
  const hideTimerRef = useRef<any>(null);
  const readyFiredRef = useRef(false);
  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;

  const clearHideTimer = () => {
    if (hideTimerRef.current) {
      clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }
  };
  const scheduleHide = (ms = 150) => {
    clearHideTimer();
    hideTimerRef.current = setTimeout(() => {
      if (!cardStickyRef.current) {
        activeGroupRef.current = null;
        setCard(null);
      }
    }, ms);
  };
  const closeCard = () => {
    clearHideTimer();
    activeGroupRef.current = null;
    setCard(null);
  };

  useEffect(() => {
    if (!mountRef.current) return;
    const el = mountRef.current;
    let frameId: number;
    let disposed = false;

    (async () => {
      const THREE = await import('three');
      if (disposed || !mountRef.current) return;

      function latLngToVector3(lat: number, lng: number, radius: number) {
        const phi = (90 - lat) * (Math.PI / 180);
        const theta = (lng + 180) * (Math.PI / 180);
        return new THREE.Vector3(
          -(radius * Math.sin(phi) * Math.cos(theta)),
          radius * Math.cos(phi),
          radius * Math.sin(phi) * Math.sin(theta)
        );
      }

      const w = el.clientWidth || 800;
      const h = el.clientHeight || 600;

      const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
      renderer.setSize(w, h);
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      el.appendChild(renderer.domElement);

      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(45, w / h, 0.1, 1000);
      const isMobile = () => typeof window !== 'undefined' && window.innerWidth < 768;
      const cameraZForViewport = () => (isMobile() ? 4.5 : 3.5);
      camera.position.z = cameraZForViewport();

      const ambient = new THREE.AmbientLight(0xffffff, 2.0);
      scene.add(ambient);
      const keyLight = new THREE.DirectionalLight(0xffffff, 2.5);
      keyLight.position.set(5, 3, 5);
      scene.add(keyLight);
      const fillLight = new THREE.DirectionalLight(0x6699ff, 1.0);
      fillLight.position.set(-5, -3, 5);
      scene.add(fillLight);
      const pointLight = new THREE.PointLight(0x4488ff, 0.3);
      pointLight.position.set(0, 0, 10);
      scene.add(pointLight);

      const features = await loadCountries();
      if (disposed) return;
      const canvasTex = drawGlobeTexture(features);
      const canvasTexture = new THREE.CanvasTexture(canvasTex);
      canvasTexture.colorSpace = THREE.SRGBColorSpace;
      canvasTexture.needsUpdate = true;

      const globeRadius = 1.0;
      const globeGeom = new THREE.SphereGeometry(globeRadius, 64, 64);
      const globeMat = new THREE.MeshPhongMaterial({ map: canvasTexture, shininess: 5 });
      const globe = new THREE.Mesh(globeGeom, globeMat);
      scene.add(globe);

      const glowGeom = new THREE.SphereGeometry(globeRadius * 1.03, 64, 64);
      const glowMat = new THREE.MeshBasicMaterial({ color: 0x0088cc, transparent: true, opacity: 0.12, side: THREE.BackSide });
      scene.add(new THREE.Mesh(glowGeom, glowMat));
      const rimGeom = new THREE.SphereGeometry(globeRadius * 1.08, 64, 64);
      const rimMat = new THREE.MeshBasicMaterial({ color: 0x0099dd, transparent: true, opacity: 0.06, side: THREE.BackSide });
      scene.add(new THREE.Mesh(rimGeom, rimMat));

      type PinEntry = { sphere: any; hit: any; group: any; cluster: Cluster };
      const pinsContainer = new THREE.Group();
      globe.add(pinsContainer);
      const pins: PinEntry[] = [];

      function clearPins() {
        for (const p of pins) {
          pinsContainer.remove(p.group);
          p.group.traverse((obj: any) => {
            if (obj.geometry) obj.geometry.dispose();
            if (obj.material) {
              if (Array.isArray(obj.material)) obj.material.forEach((m: any) => m.dispose());
              else obj.material.dispose();
            }
          });
        }
        pins.length = 0;
      }

      function buildPins() {
        clearPins();
        const clusters = buildClusters(detailersRef.current, camera.position.z);

        for (const cluster of clusters) {
          const { lat, lng, detailers: items } = cluster;
          const pos = latLngToVector3(lat, lng, globeRadius * 1.005);
          const group = new THREE.Group();
          group.position.copy(pos);

          let pinRadius: number;
          let pinColor: number;
          let pinEmissive: number;
          if (items.length === 1) {
            pinRadius = 0.014;
            pinColor = 0x0081b8;
            pinEmissive = 0x004488;
          } else if (items.length <= 3) {
            pinRadius = 0.02;
            pinColor = 0xeab308;
            pinEmissive = 0x6b4f00;
          } else {
            pinRadius = 0.026;
            pinColor = 0xeab308;
            pinEmissive = 0x6b4f00;
          }

          const sphereGeom = new THREE.SphereGeometry(pinRadius, 16, 16);
          const sphereMat = new THREE.MeshPhongMaterial({ color: pinColor, emissive: pinEmissive, emissiveIntensity: 0.3, shininess: 80 });
          const sphere = new THREE.Mesh(sphereGeom, sphereMat);
          group.add(sphere);

          const dotGeom = new THREE.SphereGeometry(pinRadius * 0.45, 8, 8);
          const dotMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
          group.add(new THREE.Mesh(dotGeom, dotMat));

          if (items.length > 1) {
            const ringGeom = new THREE.RingGeometry(pinRadius * 1.4, pinRadius * 1.7, 24);
            const ringMat = new THREE.MeshBasicMaterial({ color: pinColor, transparent: true, opacity: 0.5, side: THREE.DoubleSide });
            const ring = new THREE.Mesh(ringGeom, ringMat);
            ring.lookAt(new THREE.Vector3(0, 0, 0));
            group.add(ring);
          }

          // Invisible hit sphere ~3x the visual radius so pins are easy to
          // hover/click. Kept visible=true (raycaster skips visible=false) but
          // fully transparent so it never renders.
          const hitGeom = new THREE.SphereGeometry(pinRadius * 3, 12, 12);
          const hitMat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false });
          const hit = new THREE.Mesh(hitGeom, hitMat);
          group.add(hit);

          group.lookAt(new THREE.Vector3(0, 0, 0));
          pinsContainer.add(group);
          pins.push({ sphere, hit, group, cluster });
        }

        if (!readyFiredRef.current) {
          readyFiredRef.current = true;
          onReadyRef.current?.();
        }
      }

      buildPins();

      sceneRef.current = {
        renderer, scene, camera, globe, pins, pinsContainer, buildPins, latLngToVector3, globeRadius,
        autoRotate: true,
        targetRotation: null as null | { x: number; y: number },
        zoomTarget: null as null | number,
        lastClusterZ: camera.position.z,
        lastInteraction: Date.now(),
        hoveredGroup: null as any,
        pendingFocus: null as null | GlobeFocus,
      };

      const raycaster = new THREE.Raycaster();
      const mouse = new THREE.Vector2();
      const tmpV = new THREE.Vector3();
      const tmpCenter = new THREE.Vector3();
      const tmpCam = new THREE.Vector3();

      const markInteraction = () => {
        if (sceneRef.current) {
          sceneRef.current.autoRotate = false;
          sceneRef.current.lastInteraction = Date.now();
        }
      };

      // Pick the front-most pin under the cursor. The globe mesh is included as
      // an occluder: if the globe surface is nearer than the pin, the pin is on
      // the far hemisphere and is ignored.
      const pickPin = (clientX: number, clientY: number): PinEntry | null => {
        if (!sceneRef.current) return null;
        const rect = el.getBoundingClientRect();
        mouse.x = ((clientX - rect.left) / rect.width) * 2 - 1;
        mouse.y = -((clientY - rect.top) / rect.height) * 2 + 1;
        raycaster.setFromCamera(mouse, camera);
        const objs = [globe, ...pins.map((p) => p.hit)];
        const hits = raycaster.intersectObjects(objs, false);
        let pinHit: PinEntry | null = null;
        let pinDist = Infinity;
        let globeDist = Infinity;
        for (const hh of hits) {
          if (hh.object === globe) {
            if (hh.distance < globeDist) globeDist = hh.distance;
          } else {
            const p = pins.find((pp) => pp.hit === hh.object);
            if (p && hh.distance < pinDist) {
              pinDist = hh.distance;
              pinHit = p;
            }
          }
        }
        if (pinHit && pinDist <= globeDist + 1e-4) return pinHit;
        return null;
      };

      const areaLabel = (cluster: Cluster): string => {
        const withPlace = cluster.detailers.find((d) => detailerPlace(d));
        return withPlace ? (detailerPlace(withPlace) as string) : `${cluster.detailers.length} detailers`;
      };

      // Test hook (harmless in prod): expose live pin screen positions so a
      // browser test can hover/click exact pins inside the WebGL canvas.
      (window as any).__globe = {
        getPins: () =>
          pins.map((p) => {
            p.group.getWorldPosition(tmpV);
            globe.getWorldPosition(tmpCenter);
            camera.getWorldPosition(tmpCam);
            const facing = tmpCam.clone().sub(tmpV).dot(tmpV.clone().sub(tmpCenter)) > 0;
            const proj = tmpV.clone().project(camera);
            const rect = el.getBoundingClientRect();
            return {
              count: p.cluster.detailers.length,
              company: p.cluster.detailers[0]?.company || '',
              codes: p.cluster.detailers.map((d) => d.home_airport),
              front: facing && proj.z <= 1,
              x: rect.left + (proj.x * 0.5 + 0.5) * rect.width,
              y: rect.top + (-proj.y * 0.5 + 0.5) * rect.height,
            };
          }),
        stopRotate: () => { if (sceneRef.current) sceneRef.current.autoRotate = false; },
        cameraZ: () => camera.position.z,
      };

      const openCardForPin = (p: PinEntry, sticky: boolean) => {
        activeGroupRef.current = p.group;
        clearHideTimer();
        if (p.cluster.detailers.length === 1) {
          setCard({ kind: 'single', detailer: p.cluster.detailers[0], sticky });
        } else {
          setCard({ kind: 'cluster', detailers: sortByTier(p.cluster.detailers), area: areaLabel(p.cluster), sticky });
        }
      };

      // ─── HOVER / DRAG (pointer) ───
      let pointerActive = false;
      let dragMoved = false;
      let pointerStartX = 0;
      let pointerStartY = 0;
      let pointerLastX = 0;
      let pointerLastY = 0;

      const handleMouseDown = (e: MouseEvent) => {
        if (!sceneRef.current) return;
        pointerActive = true;
        dragMoved = false;
        pointerStartX = e.clientX;
        pointerStartY = e.clientY;
        pointerLastX = e.clientX;
        pointerLastY = e.clientY;
        markInteraction();
      };

      const handleMouseMove = (e: MouseEvent) => {
        if (!sceneRef.current) return;
        if (pointerActive) {
          const dx = e.clientX - pointerLastX;
          const dy = e.clientY - pointerLastY;
          if (Math.abs(e.clientX - pointerStartX) > 4 || Math.abs(e.clientY - pointerStartY) > 4) dragMoved = true;
          globe.rotation.y += dx * 0.005;
          globe.rotation.x += dy * 0.005;
          globe.rotation.x = Math.max(-1.2, Math.min(1.2, globe.rotation.x));
          pointerLastX = e.clientX;
          pointerLastY = e.clientY;
          sceneRef.current.lastInteraction = Date.now();
          if (dragMoved && !cardStickyRef.current) closeCard();
        } else {
          const p = pickPin(e.clientX, e.clientY);
          renderer.domElement.style.cursor = p ? 'pointer' : 'grab';
          if (p) {
            sceneRef.current.autoRotate = false;
            sceneRef.current.lastInteraction = Date.now();
            clearHideTimer();
            // Open (or switch) the hover card only when the pin changes, so we
            // don't setState on every mousemove. Never clobber a sticky card.
            if (!cardStickyRef.current && sceneRef.current.hoveredGroup !== p.group) {
              openCardForPin(p, false);
            }
            sceneRef.current.hoveredGroup = p.group;
          } else {
            sceneRef.current.hoveredGroup = null;
            if (!cardStickyRef.current) scheduleHide(150);
          }
        }
      };

      const handleMouseUp = (e: MouseEvent) => {
        if (!sceneRef.current || !pointerActive) return;
        pointerActive = false;
        const dx = e.clientX - pointerStartX;
        const dy = e.clientY - pointerStartY;
        if (Math.sqrt(dx * dx + dy * dy) < 5) {
          const p = pickPin(e.clientX, e.clientY);
          if (p) {
            if (p.cluster.detailers.length === 1) {
              openCardForPin(p, true);
            } else {
              // Cluster: zoom toward it, rotate to center, and open its member
              // list (sticky) so rows are clickable while it expands.
              const targetZ = Math.max(1.6, camera.position.z * 0.55);
              sceneRef.current.zoomTarget = targetZ;
              sceneRef.current.targetRotation = { y: -p.cluster.lng * (Math.PI / 180) - Math.PI / 2, x: p.cluster.lat * (Math.PI / 180) * 0.5 };
              sceneRef.current.autoRotate = false;
              openCardForPin(p, true);
            }
          } else if (!cardStickyRef.current) {
            closeCard();
          }
        }
      };

      const handleMouseLeave = () => {
        pointerActive = false;
        if (!cardStickyRef.current) scheduleHide(150);
      };

      // ─── WHEEL ZOOM ───
      const handleWheel = (e: WheelEvent) => {
        if (!sceneRef.current) return;
        e.preventDefault();
        markInteraction();
        const factor = e.deltaY > 0 ? 1.1 : 1 / 1.1;
        const nz = camera.position.z * factor;
        camera.position.z = Math.max(1.2, Math.min(6.0, nz));
        sceneRef.current.zoomTarget = null;
      };

      // ─── TOUCH ───
      let touchMode: 'none' | 'rotate' | 'pinch' = 'none';
      let touchLastX = 0;
      let touchLastY = 0;
      let touchStartX = 0;
      let touchStartY = 0;
      let pinchStartDistance = 0;
      let pinchStartCameraZ = 0;

      const handleTouchStart = (e: TouchEvent) => {
        if (!sceneRef.current) return;
        markInteraction();
        if (e.touches.length === 1) {
          const t = e.touches[0];
          touchMode = 'rotate';
          touchLastX = t.clientX; touchLastY = t.clientY;
          touchStartX = t.clientX; touchStartY = t.clientY;
        } else if (e.touches.length === 2) {
          touchMode = 'pinch';
          const [t1, t2] = [e.touches[0], e.touches[1]];
          pinchStartDistance = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
          pinchStartCameraZ = camera.position.z;
        }
      };

      const handleTouchMove = (e: TouchEvent) => {
        if (!sceneRef.current) return;
        e.preventDefault();
        sceneRef.current.lastInteraction = Date.now();
        if (touchMode === 'pinch' && e.touches.length === 2) {
          const [t1, t2] = [e.touches[0], e.touches[1]];
          const d = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
          if (d > 0 && pinchStartDistance > 0) {
            camera.position.z = Math.max(1.2, Math.min(6.0, pinchStartCameraZ * (pinchStartDistance / d)));
            sceneRef.current.zoomTarget = null;
          }
          return;
        }
        if (touchMode === 'rotate' && e.touches.length === 1) {
          const t = e.touches[0];
          globe.rotation.y += (t.clientX - touchLastX) * 0.005;
          globe.rotation.x += (t.clientY - touchLastY) * 0.005;
          globe.rotation.x = Math.max(-1.2, Math.min(1.2, globe.rotation.x));
          touchLastX = t.clientX; touchLastY = t.clientY;
          if ((Math.abs(t.clientX - touchStartX) > 6 || Math.abs(t.clientY - touchStartY) > 6) && !cardStickyRef.current) closeCard();
        }
      };

      const handleTouchEnd = (e: TouchEvent) => {
        if (!sceneRef.current) return;
        if (touchMode === 'rotate' && e.changedTouches.length > 0) {
          const t = e.changedTouches[0];
          if (Math.hypot(t.clientX - touchStartX, t.clientY - touchStartY) < 10) {
            // Tap = open the same card as a click.
            const p = pickPin(t.clientX, t.clientY);
            if (p) {
              if (p.cluster.detailers.length === 1) openCardForPin(p, true);
              else {
                const targetZ = Math.max(1.6, camera.position.z * 0.55);
                sceneRef.current.zoomTarget = targetZ;
                sceneRef.current.targetRotation = { y: -p.cluster.lng * (Math.PI / 180) - Math.PI / 2, x: p.cluster.lat * (Math.PI / 180) * 0.5 };
                openCardForPin(p, true);
              }
            } else if (!cardStickyRef.current) closeCard();
          }
        }
        if (e.touches.length === 1) {
          const t = e.touches[0];
          touchMode = 'rotate';
          touchLastX = t.clientX; touchLastY = t.clientY;
          touchStartX = t.clientX; touchStartY = t.clientY;
        } else if (e.touches.length === 0) {
          touchMode = 'none';
        }
      };

      const dom = renderer.domElement;
      dom.style.cursor = 'grab';
      dom.addEventListener('mousedown', handleMouseDown);
      dom.addEventListener('mousemove', handleMouseMove);
      dom.addEventListener('mouseup', handleMouseUp);
      dom.addEventListener('mouseleave', handleMouseLeave);
      dom.addEventListener('wheel', handleWheel, { passive: false });
      dom.addEventListener('touchstart', handleTouchStart, { passive: false });
      dom.addEventListener('touchmove', handleTouchMove, { passive: false });
      dom.addEventListener('touchend', handleTouchEnd, { passive: false });
      dom.addEventListener('touchcancel', handleTouchEnd, { passive: false });

      let clusterRebuildTimer: any = null;
      const scheduleClusterRebuild = () => {
        if (clusterRebuildTimer) clearTimeout(clusterRebuildTimer);
        clusterRebuildTimer = setTimeout(() => {
          if (!sceneRef.current) return;
          buildPins();
          sceneRef.current.lastClusterZ = camera.position.z;
          // If a card is open, re-anchor it to the equivalent rebuilt pin (or
          // close it if its cluster no longer exists as such).
          reanchorCard();
        }, 200);
      };

      // After a rebuild, find the pin whose cluster still contains the card's
      // detailer(s) and re-point the anchor; otherwise drop a non-sticky card.
      const reanchorCard = () => {
        const c = cardStateRef.current;
        if (!c) { activeGroupRef.current = null; return; }
        const wantId = c.kind === 'single' ? c.detailer.id : c.detailers[0]?.id;
        const match = pins.find((p) => p.cluster.detailers.some((d) => d.id === wantId));
        if (match) activeGroupRef.current = match.group;
        else if (!cardStickyRef.current) closeCard();
      };

      // Position the card next to its anchor pin every frame (imperative, no
      // React re-render). Hidden when the pin faces away or is off-screen.
      const updateCardScreenPosition = () => {
        const cardEl = cardRef.current;
        const group = activeGroupRef.current;
        if (!cardEl) return;
        if (!group || !cardStateRef.current) { cardEl.style.display = 'none'; return; }
        group.getWorldPosition(tmpV);
        globe.getWorldPosition(tmpCenter);
        camera.getWorldPosition(tmpCam);
        // Front-facing test: camera→point dotted with outward normal.
        const facing = tmpCam.clone().sub(tmpV).dot(tmpV.clone().sub(tmpCenter));
        if (facing <= 0) { cardEl.style.display = 'none'; return; }
        const proj = tmpV.clone().project(camera);
        if (proj.z > 1) { cardEl.style.display = 'none'; return; }
        const rect = el.getBoundingClientRect();
        const sx = (proj.x * 0.5 + 0.5) * rect.width;
        const sy = (-proj.y * 0.5 + 0.5) * rect.height;
        cardEl.style.display = 'block';
        // Anchor to the right of the pin, flip left near the right edge.
        const cw = cardEl.offsetWidth || 240;
        const left = sx + cw + 24 > rect.width ? sx - cw - 16 : sx + 16;
        cardEl.style.left = `${Math.round(left)}px`;
        cardEl.style.top = `${Math.round(Math.max(8, sy - 12))}px`;
      };

      const animate = () => {
        if (disposed) return;
        frameId = requestAnimationFrame(animate);
        if (!sceneRef.current) return;
        const s = sceneRef.current;

        // Resume auto-rotate after 5s idle (unless a card is pinned open).
        if (!s.autoRotate && !cardStickyRef.current && !s.hoveredGroup && !pointerActive && touchMode === 'none' && Date.now() - s.lastInteraction > 5000) {
          s.autoRotate = true;
        }
        if (s.autoRotate) globe.rotation.y += 0.002;

        if (s.targetRotation) {
          globe.rotation.y += (s.targetRotation.y - globe.rotation.y) * 0.05;
          globe.rotation.x += (s.targetRotation.x - globe.rotation.x) * 0.05;
          if (Math.abs(s.targetRotation.y - globe.rotation.y) < 0.01 && Math.abs(s.targetRotation.x - globe.rotation.x) < 0.01) {
            s.targetRotation = null;
          }
        }

        if (s.zoomTarget != null) {
          const diff = s.zoomTarget - camera.position.z;
          if (Math.abs(diff) < 0.01) { camera.position.z = s.zoomTarget; s.zoomTarget = null; }
          else camera.position.z += diff * 0.1;
        }

        const scaleFactor = camera.position.z / 3.5;
        for (const p of s.pins) p.group.scale.setScalar(scaleFactor);

        if (Math.abs(camera.position.z - s.lastClusterZ) > 0.2) {
          s.lastClusterZ = camera.position.z;
          scheduleClusterRebuild();
        }

        // Resolve a pending search focus once the camera/rotation have settled.
        if (s.pendingFocus && !s.targetRotation && s.zoomTarget == null) {
          const code = (s.pendingFocus.code || '').toUpperCase();
          s.pendingFocus = null;
          if (code) {
            const match = pins.find((p) => p.cluster.detailers.some((d) => (d.home_airport || '').toUpperCase() === code));
            if (match) openCardForPin(match, true);
          }
        }

        updateCardScreenPosition();
        renderer.render(scene, camera);
      };
      animate();

      const handleResize = () => {
        if (!mountRef.current) return;
        const nw = mountRef.current.clientWidth || 800;
        const nh = mountRef.current.clientHeight || 600;
        camera.aspect = nw / nh;
        camera.updateProjectionMatrix();
        renderer.setSize(nw, nh);
      };
      window.addEventListener('resize', handleResize);
      window.addEventListener('orientationchange', handleResize);

      (el as any).__globeCleanup = () => {
        cancelAnimationFrame(frameId);
        window.removeEventListener('resize', handleResize);
        window.removeEventListener('orientationchange', handleResize);
        dom.removeEventListener('mousedown', handleMouseDown);
        dom.removeEventListener('mousemove', handleMouseMove);
        dom.removeEventListener('mouseup', handleMouseUp);
        dom.removeEventListener('mouseleave', handleMouseLeave);
        dom.removeEventListener('wheel', handleWheel);
        dom.removeEventListener('touchstart', handleTouchStart);
        dom.removeEventListener('touchmove', handleTouchMove);
        dom.removeEventListener('touchend', handleTouchEnd);
        dom.removeEventListener('touchcancel', handleTouchEnd);
        renderer.dispose();
        if (el.contains(renderer.domElement)) el.removeChild(renderer.domElement);
        sceneRef.current = null;
      };
    })();

    return () => {
      disposed = true;
      if ((el as any).__globeCleanup) {
        (el as any).__globeCleanup();
        delete (el as any).__globeCleanup;
      }
    };
  }, [detailers]);

  // Drive search focus from the parent: animate to coords, zoom in, and (if a
  // code is given) open that airport's card once settled.
  useEffect(() => {
    if (!focus || !sceneRef.current) return;
    const s = sceneRef.current;
    s.autoRotate = false;
    s.lastInteraction = Date.now();
    s.targetRotation = { y: -focus.lng * (Math.PI / 180) - Math.PI / 2, x: focus.lat * (Math.PI / 180) * 0.5 };
    s.zoomTarget = Math.max(1.7, Math.min(camera_current(s), 2.2));
    s.pendingFocus = focus;
  }, [focus]);

  const handleZoom = useCallback((dir: 'in' | 'out') => {
    if (!sceneRef.current) return;
    const cam = sceneRef.current.camera;
    const factor = dir === 'in' ? 0.7 : 1 / 0.7; // ~30% per click
    cam.position.z = Math.max(1.2, Math.min(6.0, cam.position.z * factor));
    sceneRef.current.zoomTarget = null;
    sceneRef.current.lastInteraction = Date.now();
    sceneRef.current.autoRotate = false;
  }, []);

  const single = card?.kind === 'single' ? card.detailer : null;

  return (
    <div style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%' }}>
      <div ref={mountRef} style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%' }} />

      {/* Interactive pin card (anchored imperatively by updateCardScreenPosition) */}
      <div
        ref={cardRef}
        data-globe-card={card ? '1' : '0'}
        onMouseEnter={clearHideTimer}
        onMouseLeave={() => { if (!card?.sticky) scheduleHide(150); }}
        style={{
          position: 'absolute',
          display: card ? 'block' : 'none',
          zIndex: 25,
          width: 240,
          background: 'rgba(15, 22, 35, 0.97)',
          border: '1px solid rgba(255,255,255,0.14)',
          borderRadius: 12,
          padding: '12px 14px',
          backdropFilter: 'blur(10px)',
          boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
          color: '#fff',
        }}
      >
        {single && (
          <div>
            {card?.sticky && (
              <button onClick={closeCard} aria-label="Close" style={closeBtnStyle}>&times;</button>
            )}
            <div style={{ fontSize: 14, fontWeight: 700, lineHeight: 1.25, paddingRight: 16 }}>
              {single.company || single.name || 'Detailer'}
            </div>
            <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.6)', marginTop: 3 }}>
              {single.home_airport}
              {detailerPlace(single) ? ` · ${detailerPlace(single)}` : ''}
            </div>
            {single.has_online_booking && (
              <div style={{ fontSize: 11, color: '#4ade80', marginTop: 4 }}>● Online booking</div>
            )}
            <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
              <a href={`/detailer/${detailerSlug(single)}`} style={btnSecondary}>View Profile</a>
              <a href={`${CRM_URL}/request/${detailerSlug(single)}`} target="_blank" rel="noreferrer" style={btnPrimary}>Request Quote</a>
            </div>
          </div>
        )}
        {card?.kind === 'cluster' && (
          <div>
            {card.sticky && (
              <button onClick={closeCard} aria-label="Close" style={closeBtnStyle}>&times;</button>
            )}
            <div style={{ fontSize: 12, fontWeight: 700, paddingRight: 16 }}>
              {card.detailers.length} detailers · {card.area}
            </div>
            <div style={{ marginTop: 8, maxHeight: 190, overflowY: 'auto' }}>
              {card.detailers.map((d) => (
                <button
                  key={d.id}
                  onClick={() => setCard({ kind: 'single', detailer: d, sticky: true })}
                  style={rowStyle}
                >
                  <span style={{ fontSize: 12, fontWeight: 600, color: '#fff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {d.company || d.name}
                  </span>
                  <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.45)', flexShrink: 0 }}>{d.home_airport}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      <div style={{ position: 'absolute', bottom: 16, right: 16, display: 'flex', flexDirection: 'column', gap: 4, zIndex: 10 }}>
        <button onClick={() => handleZoom('in')} className="w-9 h-9 rounded-full bg-white/10 text-white border border-white/20 flex items-center justify-center text-lg font-bold hover:bg-white/20 transition-colors select-none" aria-label="Zoom in">+</button>
        <button onClick={() => handleZoom('out')} className="w-9 h-9 rounded-full bg-white/10 text-white border border-white/20 flex items-center justify-center text-lg font-bold hover:bg-white/20 transition-colors select-none" aria-label="Zoom out">&minus;</button>
      </div>
    </div>
  );
}

function camera_current(s: any): number {
  return s?.camera?.position?.z ?? 3.5;
}

const closeBtnStyle: CSSProperties = {
  position: 'absolute', top: 6, right: 8, background: 'transparent', border: 'none',
  color: 'rgba(255,255,255,0.5)', fontSize: 18, lineHeight: 1, cursor: 'pointer', padding: 0,
};
const btnPrimary: CSSProperties = {
  flex: 1, textAlign: 'center', background: '#3b82f6', color: '#fff', fontSize: 11, fontWeight: 600,
  padding: '7px 8px', borderRadius: 7, textDecoration: 'none', whiteSpace: 'nowrap',
};
const btnSecondary: CSSProperties = {
  flex: 1, textAlign: 'center', background: 'rgba(255,255,255,0.08)', color: '#fff', fontSize: 11, fontWeight: 600,
  padding: '7px 8px', borderRadius: 7, textDecoration: 'none', border: '1px solid rgba(255,255,255,0.14)', whiteSpace: 'nowrap',
};
const rowStyle: CSSProperties = {
  display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, width: '100%',
  background: 'transparent', border: 'none', borderRadius: 6, padding: '6px 6px', cursor: 'pointer', textAlign: 'left',
};
