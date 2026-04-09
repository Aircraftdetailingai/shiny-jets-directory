'use client';

import { useRef, useEffect, useCallback } from 'react';
import * as THREE from 'three';
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

function latLngToVector3(lat: number, lng: number, radius: number): THREE.Vector3 {
  const phi = (90 - lat) * (Math.PI / 180);
  const theta = (lng + 180) * (Math.PI / 180);
  return new THREE.Vector3(
    -(radius * Math.sin(phi) * Math.cos(theta)),
    radius * Math.cos(phi),
    radius * Math.sin(phi) * Math.sin(theta)
  );
}

export default function Globe({ detailers, onPinClick, focusAirport }: GlobeProps) {
  const mountRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<{
    renderer: THREE.WebGLRenderer;
    scene: THREE.Scene;
    camera: THREE.PerspectiveCamera;
    globe: THREE.Mesh;
    pins: { mesh: THREE.Mesh; detailer: Detailer }[];
    isDragging: boolean;
    prevMouse: { x: number; y: number };
    autoRotate: boolean;
    targetRotation: { x: number; y: number } | null;
  } | null>(null);

  const initScene = useCallback(() => {
    if (!mountRef.current) return;
    const el = mountRef.current;
    const w = el.clientWidth;
    const h = el.clientHeight;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(w, h);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    el.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(45, w / h, 0.1, 1000);
    camera.position.z = 3.2;

    // Lights
    const ambient = new THREE.AmbientLight(0x334466, 1.2);
    scene.add(ambient);
    const directional = new THREE.DirectionalLight(0x88aacc, 0.8);
    directional.position.set(5, 3, 5);
    scene.add(directional);

    // Globe — ocean
    const globeGeom = new THREE.SphereGeometry(1, 64, 64);
    const globeMat = new THREE.MeshPhongMaterial({
      color: 0x001f3f,
      shininess: 25,
      specular: 0x112244,
    });
    const globe = new THREE.Mesh(globeGeom, globeMat);
    scene.add(globe);

    // Atmosphere glow
    const glowGeom = new THREE.SphereGeometry(1.02, 64, 64);
    const glowMat = new THREE.MeshBasicMaterial({
      color: 0x0066aa,
      transparent: true,
      opacity: 0.08,
      side: THREE.BackSide,
    });
    scene.add(new THREE.Mesh(glowGeom, glowMat));

    // Outer glow (rim)
    const rimGeom = new THREE.SphereGeometry(1.06, 64, 64);
    const rimMat = new THREE.MeshBasicMaterial({
      color: 0x0088cc,
      transparent: true,
      opacity: 0.04,
      side: THREE.BackSide,
    });
    scene.add(new THREE.Mesh(rimGeom, rimMat));

    // Continent wireframe overlay (hex grid effect)
    const wireGeom = new THREE.IcosahedronGeometry(1.002, 3);
    const wireMat = new THREE.MeshBasicMaterial({
      color: 0x0d1520,
      wireframe: true,
      transparent: true,
      opacity: 0.15,
    });
    scene.add(new THREE.Mesh(wireGeom, wireMat));

    // Pins
    const pins: { mesh: THREE.Mesh; detailer: Detailer }[] = [];
    const pinGeom = new THREE.SphereGeometry(0.012, 8, 8);

    detailers.forEach(d => {
      const coords = AIRPORTS[d.home_airport?.toUpperCase()];
      if (!coords) return;
      const [lat, lng] = coords;
      const pos = latLngToVector3(lat, lng, 1.01);

      const pinMat = new THREE.MeshBasicMaterial({ color: 0x0081b8 });
      const pin = new THREE.Mesh(pinGeom, pinMat);
      pin.position.copy(pos);
      globe.add(pin);

      // White center dot
      const dotGeom = new THREE.SphereGeometry(0.005, 6, 6);
      const dotMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
      const dot = new THREE.Mesh(dotGeom, dotMat);
      dot.position.copy(pos);
      globe.add(dot);

      pins.push({ mesh: pin, detailer: d });
    });

    sceneRef.current = {
      renderer, scene, camera, globe, pins,
      isDragging: false,
      prevMouse: { x: 0, y: 0 },
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
      const moved = Math.abs(e.clientX - sceneRef.current.prevMouse.x) + Math.abs(e.clientY - sceneRef.current.prevMouse.y);
      sceneRef.current.isDragging = false;

      if (moved < 5) {
        // Click — check pin hits
        const rect = el.getBoundingClientRect();
        mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
        mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
        raycaster.setFromCamera(mouse, camera);
        const meshes = sceneRef.current.pins.map(p => p.mesh);
        const hits = raycaster.intersectObjects(meshes);
        if (hits.length > 0) {
          const hit = sceneRef.current.pins.find(p => p.mesh === hits[0].object);
          if (hit) onPinClick(hit.detailer);
        }
      }

      // Resume auto-rotate after 3 seconds
      setTimeout(() => {
        if (sceneRef.current) sceneRef.current.autoRotate = true;
      }, 3000);
    };

    renderer.domElement.addEventListener('pointerdown', handlePointerDown);
    renderer.domElement.addEventListener('pointermove', handlePointerMove);
    renderer.domElement.addEventListener('pointerup', handlePointerUp);

    // Animation loop
    let frameId: number;
    const animate = () => {
      frameId = requestAnimationFrame(animate);
      if (!sceneRef.current) return;
      const s = sceneRef.current;

      if (s.autoRotate) {
        s.globe.rotation.y += 0.001;
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
      const nw = el.clientWidth;
      const nh = el.clientHeight;
      camera.aspect = nw / nh;
      camera.updateProjectionMatrix();
      renderer.setSize(nw, nh);
    };
    window.addEventListener('resize', handleResize);

    return () => {
      cancelAnimationFrame(frameId);
      window.removeEventListener('resize', handleResize);
      renderer.domElement.removeEventListener('pointerdown', handlePointerDown);
      renderer.domElement.removeEventListener('pointermove', handlePointerMove);
      renderer.domElement.removeEventListener('pointerup', handlePointerUp);
      renderer.dispose();
      el.removeChild(renderer.domElement);
      sceneRef.current = null;
    };
  }, [detailers, onPinClick]);

  useEffect(() => {
    const cleanup = initScene();
    return cleanup;
  }, [initScene]);

  // Focus on airport when search triggers
  useEffect(() => {
    if (!focusAirport || !sceneRef.current) return;
    const coords = AIRPORTS[focusAirport.toUpperCase()];
    if (!coords) return;
    const [lat, lng] = coords;
    // Convert to rotation: y = -lng in radians, x = lat in radians
    sceneRef.current.autoRotate = false;
    sceneRef.current.targetRotation = {
      y: -lng * (Math.PI / 180) - Math.PI / 2,
      x: lat * (Math.PI / 180) * 0.5,
    };
    setTimeout(() => {
      if (sceneRef.current) sceneRef.current.autoRotate = true;
    }, 5000);
  }, [focusAirport]);

  return <div ref={mountRef} className="w-full h-full" />;
}
