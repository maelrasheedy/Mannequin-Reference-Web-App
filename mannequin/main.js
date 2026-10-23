import * as THREE from './three.js';
import { ColladaLoader } from './ColladaLoader.js';
import { OrbitControls } from './OrbitControls.js';

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x1a1a1a); 

// Camera Setup
const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1000);

// WebGL 2 Renderer
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace; 
document.body.appendChild(renderer.domElement);

// Lighting Configuration
const ambientLight = new THREE.AmbientLight(0xffffff, 0.4);
scene.add(ambientLight);

const keyLight = new THREE.DirectionalLight(0xffffff, 2.5);
keyLight.position.set(5, 10, 5);
scene.add(keyLight);

const fillLight = new THREE.DirectionalLight(0xffffff, 1.2);
fillLight.position.set(-5, 5, -5);
scene.add(fillLight);

const backLight = new THREE.DirectionalLight(0xffffff, 1.0);
backLight.position.set(0, 5, -8);
scene.add(backLight);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;       
controls.dampingFactor = 0.05;       
controls.autoRotate = false;          
controls.autoRotateSpeed = 1.5;      
controls.rotateSpeed = 1.25;
controls.zoomSpeed = 3.75; 

let loadedModel = null;

// Texture Core Pipelines
const textureLoader = new THREE.TextureLoader();
const woodAlbedo = textureLoader.load('./wooden-artist-mannequin/source/model/textures/Wood_albedo.jpg');
const woodAmbientOcclusion = textureLoader.load('./wooden-artist-mannequin/source/model/textures/Wood_AO.jpg');
const woodNormal = textureLoader.load('./wooden-artist-mannequin/source/model/textures/Wood_normal.jpg');
const woodRoughness = textureLoader.load('./wooden-artist-mannequin/source/model/textures/Wood_roughness.jpg');

woodAlbedo.colorSpace = THREE.SRGBColorSpace;

const mannequinMaterial = new THREE.MeshStandardMaterial({
    map: woodAlbedo,
    aoMap: woodAmbientOcclusion,
    aoMapIntensity: 1.0,
    metalness: 0.0, 
    normalMap: woodNormal,
    normalScale: new THREE.Vector2(1.0, 1.0),
    roughnessMap: woodRoughness,
    roughness: 0.6
});

// Model Initialization
const loadingManager = new THREE.LoadingManager();
loadingManager.setURLModifier((url) => {
    if (url.endsWith('.jpg') || url.endsWith('.jpeg') || url.endsWith('.png')) {
        return 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
    }
    return url;
});

const loader = new ColladaLoader(loadingManager);
loader.convertUpAxis = true;

loader.load(
    './wooden-artist-mannequin/source/model/model.dae',
    (collada) => {
        loadedModel = collada.scene;

        loadedModel.traverse((node) => {
            if (node.isMesh) {
                node.material = mannequinMaterial;
                node.castShadow = true;
                node.receiveShadow = true;
                node.material.needsUpdate = true;
            }
        });
        
        const box = new THREE.Box3().setFromObject(loadedModel);
        const center = box.getCenter(new THREE.Vector3());
        const size = box.getSize(new THREE.Vector3());        

        loadedModel.position.sub(center);
        scene.add(loadedModel);

        const maxDim = Math.max(size.x, size.y, size.z);
        const fov = camera.fov * (Math.PI / 180);
        let cameraZ = Math.abs(maxDim / 2 * Math.tan(fov * 2)) * 2.5;

        camera.position.set(0, maxDim * 0.4, cameraZ);
        controls.minDistance = maxDim * 0.3; // Minimum distance to prevent clipping
        controls.maxDistance = maxDim * 15; // Maximum distance to allow zooming out
        controls.target.set(0, maxDim * 0.1, 0); 
        controls.update();

        console.log('Model loaded cleanly! Dimensions computed:', size);
    },
    (xhr) => { console.log((xhr.loaded / xhr.total * 100) + '% loaded'); },
    (error) => { console.error('Asset parser crash reported:', error); }
);

function animate() {
    controls.update(); 
    renderer.render(scene, camera);
}
renderer.setAnimationLoop(animate);

window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});
