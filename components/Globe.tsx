'use client';

import { useRef, useEffect, useCallback } from 'react';
import AIRPORTS from '@/lib/airports';

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

interface GlobeProps {
  detailers: Detailer[];
  onPinClick: (detailer: Detailer) => void;
  focusAirport?: string | null;
}

export default function Globe({ detailers, onPinClick, focusAirport }: GlobeProps) {
  const mountRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<any>(null);
  const onPinClickRef = useRef(onPinClick);
  onPinClickRef.current = onPinClick;

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
      camera.position.z = 3.2;

      // Lights
      const ambient = new THREE.AmbientLight(0xffffff, 1.5);
      scene.add(ambient);
      const directional = new THREE.DirectionalLight(0x88aacc, 0.6);
      directional.position.set(5, 3, 5);
      scene.add(directional);

      // Load earth texture
      const textureLoader = new THREE.TextureLoader();
      const earthTexture = await new Promise<any>((resolve) => {
        textureLoader.load(
          'https://unpkg.com/three-globe/example/img/earth-dark.jpg',
          (tex: any) => resolve(tex),
          undefined,
          () => resolve(null)
        );
      });

      if (disposed) return;

      // Globe sphere with texture
      const globeGeom = new THREE.SphereGeometry(1, 64, 64);
      let globeMat;
      if (earthTexture) {
        globeMat = new THREE.MeshPhongMaterial({
          map: earthTexture,
          color: 0x0d1520,
          emissive: 0x001830,
          emissiveIntensity: 0.3,
          shininess: 15,
          specular: 0x111122,
        });
      } else {
        // Fallback if texture fails to load
        globeMat = new THREE.MeshPhongMaterial({
          color: 0x001f3f,
          shininess: 25,
          specular: 0x112244,
        });
      }
      const globe = new THREE.Mesh(globeGeom, globeMat);
      scene.add(globe);

      // Atmosphere glow
      const glowGeom = new THREE.SphereGeometry(1.025, 64, 64);
      const glowMat = new THREE.MeshBasicMaterial({
        color: 0x0066aa,
        transparent: true,
        opacity: 0.1,
        side: THREE.BackSide,
      });
      scene.add(new THREE.Mesh(glowGeom, glowMat));

      // Outer rim glow
      const rimGeom = new THREE.SphereGeometry(1.08, 64, 64);
      const rimMat = new THREE.MeshBasicMaterial({
        color: 0x0088cc,
        transparent: true,
        opacity: 0.05,
        side: THREE.BackSide,
      });
      scene.add(new THREE.Mesh(rimGeom, rimMat));

      // Pins
      const pins: { mesh: any; detailer: Detailer }[] = [];
      const pinGeom = new THREE.SphereGeometry(0.015, 8, 8);

      detailers.forEach(d => {
        const coords = AIRPORTS[d.home_airport?.toUpperCase()];
        if (!coords) return;
        const [lat, lng] = coords;
        const pos = latLngToVector3(lat, lng, 1.015);

        const pinMat = new THREE.MeshBasicMaterial({ color: 0x00aaff });
        const pin = new THREE.Mesh(pinGeom, pinMat);
        pin.position.copy(pos);
        globe.add(pin);

        // Bright center dot
        const dotGeom = new THREE.SphereGeometry(0.006, 6, 6);
        const dotMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
        const dot = new THREE.Mesh(dotGeom, dotMat);
        dot.position.copy(pos);
        globe.add(dot);

        // Pulse ring
        const ringGeom = new THREE.RingGeometry(0.018, 0.025, 16);
        const ringMat = new THREE.MeshBasicMaterial({
          color: 0x00aaff,
          transparent: true,
          opacity: 0.3,
          side: THREE.DoubleSide,
        });
        const ring = new THREE.Mesh(ringGeom, ringMat);
        ring.position.copy(pos);
        ring.lookAt(new THREE.Vector3(0, 0, 0));
        globe.add(ring);

        pins.push({ mesh: pin, detailer: d });
      });

      sceneRef.current = {
        renderer, scene, camera, globe, pins,
        isDragging: false,
        prevMouse: { x: 0, y: 0 },
        startMouse: { x: 0, y: 0 },
        autoRotate: true,
        targetRotation: null,
      };

      // Raycaster for pin clicks
      const raycaster = new THREE.Raycaster();
      const mouse = new THREE.Vector2();

      const handlePointerDown = (e: PointerEvent) => {
        if (!sceneRef.current) return;
        sceneRef.current.isDragging = true;
        sceneRef.current.autoRotate = false;
        sceneRef.current.prevMouse = { x: e.clientX, y: e.clientY };
        sceneRef.current.startMouse = { x: e.clientX, y: e.clientY };
      };

      const handlePointerMove = (e: PointerEvent) => {
        if (!sceneRef.current?.isDragging) return;
        const dx = e.clientX - sceneRef.current.prevMouse.x;
        const dy = e.clientY - sceneRef.current.prevMouse.y;
        sceneRef.current.globe.rotation.y += dx * 0.005;
        sceneRef.current.globe.rotation.x += dy * 0.005;
        sceneRef.current.globe.rotation.x = Math.max(-1.2, Math.min(1.2, sceneRef.current.globe.rotation.x));
        sceneRef.current.prevMouse = { x: e.clientX, y: e.clientY };
      };

      const handlePointerUp = (e: PointerEvent) => {
        if (!sceneRef.current) return;
        const moved = Math.abs(e.clientX - sceneRef.current.startMouse.x) + Math.abs(e.clientY - sceneRef.current.startMouse.y);
        sceneRef.current.isDragging = false;

        if (moved < 5) {
          const rect = el.getBoundingClientRect();
          mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
          mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
          raycaster.setFromCamera(mouse, camera);
          const meshes = sceneRef.current.pins.map((p: any) => p.mesh);
          const hits = raycaster.intersectObjects(meshes);
          if (hits.length > 0) {
            const hit = sceneRef.current.pins.find((p: any) => p.mesh === hits[0].object);
            if (hit) onPinClickRef.current(hit.detailer);
          }
        }

        setTimeout(() => {
          if (sceneRef.current) sceneRef.current.autoRotate = true;
        }, 3000);
      };

      renderer.domElement.addEventListener('pointerdown', handlePointerDown);
      renderer.domElement.addEventListener('pointermove', handlePointerMove);
      renderer.domElement.addEventListener('pointerup', handlePointerUp);

      // Animation loop
      const animate = () => {
        if (disposed) return;
        frameId = requestAnimationFrame(animate);
        if (!sceneRef.current) return;
        const s = sceneRef.current;

        if (s.autoRotate) {
          s.globe.rotation.y += 0.0008;
        }

        if (s.targetRotation) {
          s.globe.rotation.y += (s.targetRotation.y - s.globe.rotation.y) * 0.03;
          s.globe.rotation.x += (s.targetRotation.x - s.globe.rotation.x) * 0.03;
          if (Math.abs(s.targetRotation.y - s.globe.rotation.y) < 0.01) {
            s.targetRotation = null;
          }
        }

        renderer.render(scene, camera);
      };
      animate();

      // Resize handler
      const handleResize = () => {
        if (!mountRef.current) return;
        const nw = mountRef.current.clientWidth || 800;
        const nh = mountRef.current.clientHeight || 600;
        camera.aspect = nw / nh;
        camera.updateProjectionMatrix();
        renderer.setSize(nw, nh);
      };
      window.addEventListener('resize', handleResize);

      (el as any).__globeCleanup = () => {
        cancelAnimationFrame(frameId);
        window.removeEventListener('resize', handleResize);
        renderer.domElement.removeEventListener('pointerdown', handlePointerDown);
        renderer.domElement.removeEventListener('pointermove', handlePointerMove);
        renderer.domElement.removeEventListener('pointerup', handlePointerUp);
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
    cam.position.z = Math.max(2.0, Math.min(5.0, cam.position.z + delta));
  }, []);

  return (
    <div style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%' }}>
      <div
        ref={mountRef}
        style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%' }}
      />
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
