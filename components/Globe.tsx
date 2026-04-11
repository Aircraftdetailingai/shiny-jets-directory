'use client';

import { useRef, useEffect, useCallback, useState } from 'react';
import AIRPORTS from '@/lib/airports';
import { feature } from 'topojson-client';

interface Detailer {
  id: string;
  company: string;
  name: string;
  home_airport: string;
  plan: string;
  has_online_booking: boolean;
  logo_url?: string;
  slug?: string;
}

interface Cluster {
  lat: number;
  lng: number;
  detailers: Detailer[];
}

// Haversine distance in miles between two lat/lng points
function distanceMiles(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 3958.8; // Earth radius in miles
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

const PLAN_TIER: Record<string, number> = { enterprise: 3, business: 2, pro: 1, free: 0 };

function topDetailer(detailers: Detailer[]): Detailer {
  return [...detailers].sort((a, b) => (PLAN_TIER[b.plan] || 0) - (PLAN_TIER[a.plan] || 0))[0];
}

// Threshold based on camera distance: closer = smaller threshold = more individual pins
function clusterThresholdMiles(cameraZ: number): number {
  if (cameraZ > 4.0) return 500;
  if (cameraZ > 2.5) return 100;
  return 0; // Below 2.5: only same-airport pins are merged (threshold 0)
}

function buildClusters(detailers: Detailer[], cameraZ: number): Cluster[] {
  const threshold = clusterThresholdMiles(cameraZ);
  // Resolve airport coords for each detailer
  const points: { lat: number; lng: number; detailer: Detailer }[] = [];
  for (const d of detailers) {
    const coords = AIRPORTS[(d.home_airport || '').toUpperCase()];
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

    // Find all other points within threshold
    let centerLat = seed.lat;
    let centerLng = seed.lng;
    for (let j = i + 1; j < points.length; j++) {
      if (used.has(j)) continue;
      const p = points[j];
      const dist = distanceMiles(centerLat, centerLng, p.lat, p.lng);
      if (dist <= threshold) {
        group.push(p.detailer);
        used.add(j);
        // Update centroid for subsequent comparisons
        centerLat = (centerLat * (group.length - 1) + p.lat) / group.length;
        centerLng = (centerLng * (group.length - 1) + p.lng) / group.length;
      }
    }

    clusters.push({ lat: centerLat, lng: centerLng, detailers: group });
  }

  return clusters;
}

interface GlobeProps {
  detailers: Detailer[];
  onPinClick: (detailer: Detailer) => void;
  focusAirport?: string | null;
}

// Cached GeoJSON features so we only fetch once
let cachedFeatures: any[] | null = null;

async function loadCountries(): Promise<any[]> {
  if (cachedFeatures) return cachedFeatures;
  try {
    const res = await fetch('https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json');
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

// Helper: convert lng/lat to canvas x/y (equirectangular projection)
function lngLatToXY(lng: number, lat: number, w: number, h: number): [number, number] {
  const x = ((lng + 180) / 360) * w;
  const y = ((90 - lat) / 180) * h;
  return [x, y];
}

// Draw a GeoJSON polygon ring on canvas
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

  // Ocean — deep navy
  ctx.fillStyle = '#001f3f';
  ctx.fillRect(0, 0, w, h);

  // Draw all countries from real GeoJSON
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

  // Hex dot overlay across whole globe for texture
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

export default function Globe({ detailers, onPinClick, focusAirport }: GlobeProps) {
  const mountRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<any>(null);
  const onPinClickRef = useRef(onPinClick);
  onPinClickRef.current = onPinClick;
  const detailersRef = useRef(detailers);
  detailersRef.current = detailers;
  const [tooltip, setTooltip] = useState<{ x: number; y: number; lines: string[] } | null>(null);

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

      // Lights — bright enough to clearly show continents
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

      // Load real country GeoJSON and generate canvas texture
      const features = await loadCountries();
      if (disposed) return;
      const canvas = drawGlobeTexture(features);
      const canvasTexture = new THREE.CanvasTexture(canvas);
      canvasTexture.colorSpace = THREE.SRGBColorSpace;
      canvasTexture.needsUpdate = true;

      // Globe sphere — radius 1.0, camera distance controls visible size
      const globeRadius = 1.0;
      const globeGeom = new THREE.SphereGeometry(globeRadius, 64, 64);
      const globeMat = new THREE.MeshPhongMaterial({
        map: canvasTexture,
        shininess: 5,
      });
      const globe = new THREE.Mesh(globeGeom, globeMat);
      scene.add(globe);

      // Atmosphere glow
      const glowGeom = new THREE.SphereGeometry(globeRadius * 1.03, 64, 64);
      const glowMat = new THREE.MeshBasicMaterial({
        color: 0x0088cc,
        transparent: true,
        opacity: 0.12,
        side: THREE.BackSide,
      });
      scene.add(new THREE.Mesh(glowGeom, glowMat));

      // Outer rim glow
      const rimGeom = new THREE.SphereGeometry(globeRadius * 1.08, 64, 64);
      const rimMat = new THREE.MeshBasicMaterial({
        color: 0x0099dd,
        transparent: true,
        opacity: 0.06,
        side: THREE.BackSide,
      });
      scene.add(new THREE.Mesh(rimGeom, rimMat));

      // Pins — built as clusters that re-render when zoom changes
      type PinEntry = { mesh: any; group: any; cluster: Cluster };
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
        console.log('[Globe] building pins for:', detailersRef.current.map(d => ({ company: d.company, airport: d.home_airport })));
        console.log('[Globe] KCNO in airports:', AIRPORTS['KCNO']);
        console.log('[Globe] cluster count:', clusters.length, 'cameraZ:', camera.position.z);

        for (const cluster of clusters) {
          const { lat, lng, detailers: items } = cluster;
          // Position pins just above the globe surface (small offset since pins are tiny)
          const pos = latLngToVector3(lat, lng, globeRadius * 1.005);

          const group = new THREE.Group();
          group.position.copy(pos);

          let pinRadius: number;
          let pinColor: number;
          let pinEmissive: number;

          if (items.length === 1) {
            pinRadius = 0.012;
            pinColor = 0x0081b8; // bright blue per spec
            pinEmissive = 0x004488;
          } else if (items.length <= 3) {
            pinRadius = 0.018;
            pinColor = 0xeab308; // gold
            pinEmissive = 0x6b4f00;
          } else {
            pinRadius = 0.022;
            pinColor = 0xeab308;
            pinEmissive = 0x6b4f00;
          }

          // Sphere mesh — this is what the raycaster hits
          const sphereGeom = new THREE.SphereGeometry(pinRadius, 16, 16);
          const sphereMat = new THREE.MeshPhongMaterial({
            color: pinColor,
            emissive: pinEmissive,
            emissiveIntensity: 0.3,
            shininess: 80,
          });
          const sphere = new THREE.Mesh(sphereGeom, sphereMat);
          group.add(sphere);

          // White center dot for visibility
          const dotGeom = new THREE.SphereGeometry(pinRadius * 0.45, 8, 8);
          const dotMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
          const dot = new THREE.Mesh(dotGeom, dotMat);
          group.add(dot);

          // Halo ring for clusters with 2+ items
          if (items.length > 1) {
            const ringGeom = new THREE.RingGeometry(pinRadius * 1.4, pinRadius * 1.7, 24);
            const ringMat = new THREE.MeshBasicMaterial({
              color: pinColor,
              transparent: true,
              opacity: 0.5,
              side: THREE.DoubleSide,
            });
            const ring = new THREE.Mesh(ringGeom, ringMat);
            ring.lookAt(new THREE.Vector3(0, 0, 0));
            group.add(ring);
          }

          // Orient the pin outward from the globe center
          group.lookAt(new THREE.Vector3(0, 0, 0));

          pinsContainer.add(group);
          pins.push({ mesh: sphere, group, cluster });
        }
      }

      buildPins();

      sceneRef.current = {
        renderer, scene, camera, globe, pins, pinsContainer, buildPins,
        isDragging: false,
        prevMouse: { x: 0, y: 0 },
        startMouse: { x: 0, y: 0 },
        autoRotate: true,
        targetRotation: null,
        lastClusterZ: camera.position.z,
        zoomTarget: null as null | number,
      };

      const raycaster = new THREE.Raycaster();
      const mouse = new THREE.Vector2();

      // Pointer/mouse interaction state
      let pointerActive = false;
      let pointerStartX = 0;
      let pointerStartY = 0;
      let pointerLastX = 0;
      let pointerLastY = 0;

      // Touch state — track up to 2 fingers for pinch
      let touchMode: 'none' | 'rotate' | 'pinch' = 'none';
      let touchLastX = 0;
      let touchLastY = 0;
      let pinchStartDistance = 0;
      let pinchStartCameraZ = 0;

      const stopAutoRotate = () => {
        if (sceneRef.current) sceneRef.current.autoRotate = false;
      };

      // ─── MOUSE/POINTER (desktop) ───
      const handleMouseDown = (e: MouseEvent) => {
        if (!sceneRef.current) return;
        pointerActive = true;
        pointerStartX = e.clientX;
        pointerStartY = e.clientY;
        pointerLastX = e.clientX;
        pointerLastY = e.clientY;
        stopAutoRotate();
      };

      const handleMouseMove = (e: MouseEvent) => {
        if (!sceneRef.current) return;
        if (pointerActive) {
          const dx = e.clientX - pointerLastX;
          const dy = e.clientY - pointerLastY;
          sceneRef.current.globe.rotation.y += dx * 0.005;
          sceneRef.current.globe.rotation.x += dy * 0.005;
          sceneRef.current.globe.rotation.x = Math.max(-1.2, Math.min(1.2, sceneRef.current.globe.rotation.x));
          pointerLastX = e.clientX;
          pointerLastY = e.clientY;
          setTooltip(null);
        } else {
          // Hover detection
          handleHover(e.clientX, e.clientY);
        }
      };

      const handleMouseUp = (e: MouseEvent) => {
        if (!sceneRef.current || !pointerActive) return;
        pointerActive = false;
        // Click vs drag detection: 5px threshold from start position
        const dx = e.clientX - pointerStartX;
        const dy = e.clientY - pointerStartY;
        const distance = Math.sqrt(dx * dx + dy * dy);
        if (distance < 5) {
          tryPinClick(e.clientX, e.clientY);
        }
        // Do NOT resume auto-rotate
      };

      const handleMouseLeave = () => {
        pointerActive = false;
        setTooltip(null);
      };

      const tryPinClick = (clientX: number, clientY: number) => {
        if (!sceneRef.current) return;
        const rect = el.getBoundingClientRect();
        mouse.x = ((clientX - rect.left) / rect.width) * 2 - 1;
        mouse.y = -((clientY - rect.top) / rect.height) * 2 + 1;
        raycaster.setFromCamera(mouse, camera);
        const meshes = sceneRef.current.pins.map((p: any) => p.mesh);
        const hits = raycaster.intersectObjects(meshes);
        if (hits.length === 0) return;
        const hit = sceneRef.current.pins.find((p: any) => p.mesh === hits[0].object);
        if (!hit) return;

        const cluster: Cluster = hit.cluster;
        if (cluster.detailers.length === 1) {
          // Individual pin → open card
          onPinClickRef.current(cluster.detailers[0]);
        } else {
          // Cluster → zoom in toward this cluster, rotate to center it
          const currentZ = sceneRef.current.camera.position.z;
          const targetZ = Math.max(2.0, currentZ * 0.6);
          sceneRef.current.zoomTarget = targetZ;
          sceneRef.current.targetRotation = {
            y: -cluster.lng * (Math.PI / 180) - Math.PI / 2,
            x: cluster.lat * (Math.PI / 180) * 0.5,
          };
          sceneRef.current.autoRotate = false;
        }
      };

      // Hover tooltip detection (desktop only)
      const handleHover = (clientX: number, clientY: number) => {
        if (!sceneRef.current) return;
        const rect = el.getBoundingClientRect();
        mouse.x = ((clientX - rect.left) / rect.width) * 2 - 1;
        mouse.y = -((clientY - rect.top) / rect.height) * 2 + 1;
        raycaster.setFromCamera(mouse, camera);
        const meshes = sceneRef.current.pins.map((p: any) => p.mesh);
        const hits = raycaster.intersectObjects(meshes);
        if (hits.length === 0) {
          setTooltip(null);
          return;
        }
        const hit = sceneRef.current.pins.find((p: any) => p.mesh === hits[0].object);
        if (!hit) {
          setTooltip(null);
          return;
        }
        const cluster: Cluster = hit.cluster;
        const cameraZ = sceneRef.current.camera.position.z;
        const lines: string[] = [];

        if (cluster.detailers.length === 1) {
          // Close zoom / individual: name + airport + booking badge
          const d = cluster.detailers[0];
          lines.push(d.company || d.name || 'Detailer');
          if (d.home_airport) lines.push(d.home_airport);
          if (d.has_online_booking) lines.push('● Online Booking');
        } else if (cameraZ > 4.0) {
          // Far cluster: top + count
          const top = topDetailer(cluster.detailers);
          lines.push(top.company || top.name || 'Detailer');
          lines.push(`+${cluster.detailers.length - 1} more nearby`);
        } else {
          // Medium cluster: top 2-3
          const sorted = [...cluster.detailers].sort((a, b) => (PLAN_TIER[b.plan] || 0) - (PLAN_TIER[a.plan] || 0));
          const shown = sorted.slice(0, 3);
          for (const d of shown) lines.push(d.company || d.name || 'Detailer');
          if (sorted.length > 3) lines.push(`+${sorted.length - 3} more`);
        }

        setTooltip({ x: clientX - rect.left, y: clientY - rect.top, lines });
      };

      // ─── TOUCH (mobile) ───
      const handleTouchStart = (e: TouchEvent) => {
        if (!sceneRef.current) return;
        stopAutoRotate();

        if (e.touches.length === 1) {
          const t = e.touches[0];
          touchMode = 'rotate';
          touchLastX = t.clientX;
          touchLastY = t.clientY;
          pointerStartX = t.clientX;
          pointerStartY = t.clientY;
        } else if (e.touches.length === 2) {
          touchMode = 'pinch';
          const t1 = e.touches[0];
          const t2 = e.touches[1];
          pinchStartDistance = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
          pinchStartCameraZ = sceneRef.current.camera.position.z;
        }
      };

      const handleTouchMove = (e: TouchEvent) => {
        if (!sceneRef.current) return;
        // Prevent page scroll while interacting with the globe
        e.preventDefault();

        if (touchMode === 'pinch' && e.touches.length === 2) {
          const t1 = e.touches[0];
          const t2 = e.touches[1];
          const currentDistance = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
          if (currentDistance > 0 && pinchStartDistance > 0) {
            const newZ = pinchStartCameraZ * (pinchStartDistance / currentDistance);
            sceneRef.current.camera.position.z = Math.max(1.2, Math.min(6.0, newZ));
          }
          return;
        }

        if (touchMode === 'rotate' && e.touches.length === 1) {
          const t = e.touches[0];
          const dx = t.clientX - touchLastX;
          const dy = t.clientY - touchLastY;
          sceneRef.current.globe.rotation.y += dx * 0.005;
          sceneRef.current.globe.rotation.x += dy * 0.005;
          sceneRef.current.globe.rotation.x = Math.max(-1.2, Math.min(1.2, sceneRef.current.globe.rotation.x));
          touchLastX = t.clientX;
          touchLastY = t.clientY;
        }
      };

      const handleTouchEnd = (e: TouchEvent) => {
        if (!sceneRef.current) return;
        // If we were in single-touch rotate mode and finger barely moved, treat as tap
        if (touchMode === 'rotate' && e.changedTouches.length > 0) {
          const t = e.changedTouches[0];
          const dx = t.clientX - pointerStartX;
          const dy = t.clientY - pointerStartY;
          const distance = Math.sqrt(dx * dx + dy * dy);
          if (distance < 10) {
            tryPinClick(t.clientX, t.clientY);
          }
        }
        // Transition to remaining touches
        if (e.touches.length === 1) {
          const t = e.touches[0];
          touchMode = 'rotate';
          touchLastX = t.clientX;
          touchLastY = t.clientY;
          pointerStartX = t.clientX;
          pointerStartY = t.clientY;
        } else if (e.touches.length === 0) {
          touchMode = 'none';
        }
      };

      const dom = renderer.domElement;
      dom.addEventListener('mousedown', handleMouseDown);
      dom.addEventListener('mousemove', handleMouseMove);
      dom.addEventListener('mouseup', handleMouseUp);
      dom.addEventListener('mouseleave', handleMouseLeave);
      dom.addEventListener('touchstart', handleTouchStart, { passive: false });
      dom.addEventListener('touchmove', handleTouchMove, { passive: false });
      dom.addEventListener('touchend', handleTouchEnd, { passive: false });
      dom.addEventListener('touchcancel', handleTouchEnd, { passive: false });

      // Debounced cluster rebuild on zoom changes
      let clusterRebuildTimer: any = null;
      const scheduleClusterRebuild = () => {
        if (clusterRebuildTimer) clearTimeout(clusterRebuildTimer);
        clusterRebuildTimer = setTimeout(() => {
          if (sceneRef.current) {
            buildPins();
            sceneRef.current.lastClusterZ = sceneRef.current.camera.position.z;
          }
        }, 300);
      };

      const animate = () => {
        if (disposed) return;
        frameId = requestAnimationFrame(animate);
        if (!sceneRef.current) return;
        const s = sceneRef.current;

        if (s.autoRotate) {
          s.globe.rotation.y += 0.002;
        }

        if (s.targetRotation) {
          s.globe.rotation.y += (s.targetRotation.y - s.globe.rotation.y) * 0.03;
          s.globe.rotation.x += (s.targetRotation.x - s.globe.rotation.x) * 0.03;
          if (Math.abs(s.targetRotation.y - s.globe.rotation.y) < 0.01) {
            s.targetRotation = null;
          }
        }

        // Smooth camera zoom animation (when triggered by cluster click)
        if (s.zoomTarget != null) {
          const diff = s.zoomTarget - s.camera.position.z;
          if (Math.abs(diff) < 0.01) {
            s.camera.position.z = s.zoomTarget;
            s.zoomTarget = null;
          } else {
            s.camera.position.z += diff * 0.08;
          }
        }

        // Screen-space pin scaling — keep pins the same visual size at any zoom
        // Scale proportional to camera distance so closer = smaller 3D size, further = larger
        const scaleFactor = s.camera.position.z / 3.5;
        for (const p of s.pins) {
          p.group.scale.setScalar(scaleFactor);
        }

        // Detect zoom change and re-cluster (debounced)
        if (Math.abs(s.camera.position.z - s.lastClusterZ) > 0.3) {
          s.lastClusterZ = s.camera.position.z;
          scheduleClusterRebuild();
        }

        renderer.render(scene, camera);
      };
      animate();

      const handleResize = () => {
        if (!mountRef.current) return;
        const nw = mountRef.current.clientWidth || 800;
        const nh = mountRef.current.clientHeight || 600;
        camera.aspect = nw / nh;
        camera.position.z = cameraZForViewport();
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
        dom.removeEventListener('touchstart', handleTouchStart);
        dom.removeEventListener('touchmove', handleTouchMove);
        dom.removeEventListener('touchend', handleTouchEnd);
        dom.removeEventListener('touchcancel', handleTouchEnd);
        renderer.dispose();
        if (el.contains(renderer.domElement)) {
          el.removeChild(renderer.domElement);
        }
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

  // Focus on airport when search triggers
  useEffect(() => {
    if (!focusAirport || !sceneRef.current) return;
    const coords = AIRPORTS[focusAirport.toUpperCase()];
    if (!coords) return;
    const [lat, lng] = coords;
    sceneRef.current.autoRotate = false;
    sceneRef.current.targetRotation = {
      y: -lng * (Math.PI / 180) - Math.PI / 2,
      x: lat * (Math.PI / 180) * 0.5,
    };
    setTimeout(() => {
      if (sceneRef.current) sceneRef.current.autoRotate = true;
    }, 5000);
  }, [focusAirport]);

  const handleZoom = useCallback((dir: 'in' | 'out') => {
    if (!sceneRef.current) return;
    const cam = sceneRef.current.camera;
    const delta = dir === 'in' ? -0.3 : 0.3;
    cam.position.z = Math.max(1.2, Math.min(6.0, cam.position.z + delta));
  }, []);

  return (
    <div style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%' }}>
      <div
        ref={mountRef}
        style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%' }}
      />

      {/* Hover tooltip */}
      {tooltip && (
        <div
          style={{
            position: 'absolute',
            left: tooltip.x + 14,
            top: tooltip.y - 10,
            zIndex: 20,
            pointerEvents: 'none',
            background: 'rgba(15, 22, 35, 0.95)',
            border: '1px solid rgba(255,255,255,0.12)',
            borderRadius: 8,
            padding: '8px 12px',
            backdropFilter: 'blur(8px)',
            boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
            maxWidth: 240,
          }}
        >
          {tooltip.lines.map((line, i) => (
            <div
              key={i}
              style={{
                color: i === 0 ? '#fff' : 'rgba(255,255,255,0.6)',
                fontSize: i === 0 ? 13 : 11,
                fontWeight: i === 0 ? 600 : 400,
                lineHeight: 1.4,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              {line}
            </div>
          ))}
        </div>
      )}

      <div style={{ position: 'absolute', bottom: 16, right: 16, display: 'flex', flexDirection: 'column', gap: 4, zIndex: 10 }}>
        <button
          onClick={() => handleZoom('in')}
          className="w-9 h-9 rounded-full bg-white/10 text-white border border-white/20 flex items-center justify-center text-lg font-bold hover:bg-white/20 transition-colors select-none"
          aria-label="Zoom in"
        >
          +
        </button>
        <button
          onClick={() => handleZoom('out')}
          className="w-9 h-9 rounded-full bg-white/10 text-white border border-white/20 flex items-center justify-center text-lg font-bold hover:bg-white/20 transition-colors select-none"
          aria-label="Zoom out"
        >
          &minus;
        </button>
      </div>
    </div>
  );
}
