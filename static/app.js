// Конфигурация
const EMOJI_MAP = {
    "кошка": "🐱",
    "собака": "🐶",
    "дом": "🏠",
    "машина": "🚗",
    "мама": "👩"
};

// Параметры мира
const WORLD_SCALE = 1.0;
const GATE_DISTANCE = 40; 
// Камера фиксированная
const CAMERA_OFFSET_X = 1; 
const CAMERA_OFFSET_Y = 6;   
const CAMERA_OFFSET_Z = 15;

class ARGame {
    constructor() {
        // Состояние игры
        this.words = [];
        this.answers = {};
        this.currentIndex = 0;
        this.isRecording = false;
        this.mediaRecorder = null;
        this.audioChunks = [];
        this.isMoving = false;

        // Three.js компоненты
        this.scene = null;
        this.camera = null;
        this.renderer = null;
        
        // Группы сцены
        this.worldGroup = null; // Повернутый контейнер всего мира
        this.contentGroup = null; // Движущаяся часть (дорога + ворота)
        
        this.avatar = null;
        this.gates = [];
        this.particles = [];
        
        // DOM Элементы
        this.videoElement = document.getElementById('camera-feed');
        this.recordBtn = document.getElementById('recordBtn');
        this.progressBar = document.getElementById('progressBar');
        this.currentWordEl = document.getElementById('currentWord');
        this.popupEl = document.getElementById('popupResult');

        // Инициализация
        this.initThreeJS();
        this.initWebcamAndAudio();
        this.loadWords();
        
        // Обработчики событий
        this.recordBtn.addEventListener('click', () => this.toggleRecording());
        window.addEventListener('resize', () => this.onWindowResize());
        
        // Запуск анимации
        this.animate();
    }

    // --- Инициализация 3D ---
    initThreeJS() {
        // Сцена
        this.scene = new THREE.Scene();
        this.scene.background = null; 

        // Камера (в глобальной сцене, статичная)
        this.camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1000);
        this.scene.add(this.camera);
        
        // Рендерер
        this.renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.domElement.id = 'game-canvas';
        document.body.appendChild(this.renderer.domElement);

        // Свет
        const ambientLight = new THREE.AmbientLight(0xffffff, 0.8);
        this.scene.add(ambientLight);
        const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
        dirLight.position.set(5, 10, 5);
        this.scene.add(dirLight);

        // --- Структура Сцены ---
        
        // 1. World Group: Поворачивает весь мир для диагонального эффекта
        this.worldGroup = new THREE.Group();
        this.worldGroup.rotation.y = -Math.PI / 3; // -30 градусов (диагональ)
        this.worldGroup.position.x = -6;
        this.worldGroup.position.y = -5;
        this.scene.add(this.worldGroup);

        // 2. Content Group: Содержит дорогу и ворота. Мы будем двигать эту группу НА игрока.
        this.contentGroup = new THREE.Group();
        this.worldGroup.add(this.contentGroup);

        // Создаем объекты
        this.createRoad();
        
        // Устанавливаем камеру в начальное положение (один раз!)
        this.setupCamera();
    }

    setupCamera() {
        // Камера смотрит на начало координат мира (где стоит аватар)
        // Но сама она находится в глобальных координатах
        this.camera.position.set(0, CAMERA_OFFSET_Y, CAMERA_OFFSET_Z);
        this.camera.lookAt(0, 1, -5); // Смотрим чуть вперед и вниз
    }

    createRoad() {
        const roadLength = 1000; 
        const roadWidth = 8; 

        // 1. Асфальт
        const geometry = new THREE.PlaneGeometry(roadWidth, roadLength);
        const material = new THREE.MeshPhongMaterial({ 
            color: 0x555555, // Светло-серый
            side: THREE.DoubleSide 
        });
        const road = new THREE.Mesh(geometry, material);
        road.rotation.x = -Math.PI / 2; 
        
        // Дорога уходит вдаль от Z=20 до Z=-980
        road.position.set(0, 0, -roadLength / 2 + 20); 
        
        this.contentGroup.add(road); // ВАЖНО: Добавляем в contentGroup

        // 2. Разметка
        const lineGeo = new THREE.PlaneGeometry(0.8, roadLength); 
        const canvas = document.createElement('canvas');
        canvas.width = 64;
        canvas.height = 128;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#FFD700'; 
        ctx.fillRect(0, 32, 64, 64); 
        
        const texture = new THREE.CanvasTexture(canvas);
        texture.wrapS = THREE.RepeatWrapping;
        texture.wrapT = THREE.RepeatWrapping;
        texture.repeat.set(1, roadLength / 10); 
        
        const lineMat = new THREE.MeshBasicMaterial({ 
            map: texture,
            transparent: true 
        });
        
        const line = new THREE.Mesh(lineGeo, lineMat);
        line.rotation.x = -Math.PI / 2;
        line.position.set(0, 0.1, -roadLength / 2 + 20);
        
        this.contentGroup.add(line); // ВАЖНО: Добавляем в contentGroup
    }

    createGate(zPos, index) {
        const geometry = new THREE.TorusGeometry(3, 0.3, 16, 100);
        const material = new THREE.MeshStandardMaterial({ 
            color: 0x3498db, 
            emissive: 0x112244 
        });
        const gate = new THREE.Mesh(geometry, material);
        
        // Ворота стоят на дороге
        gate.position.set(0, 3, zPos); 
        
        this.contentGroup.add(gate); // ВАЖНО: Добавляем в contentGroup
        
        this.gates.push({ mesh: gate, z: zPos, passed: false });
    }

    setupLevelEnvironment() {
        // Создаем ворота
        this.words.forEach((word, index) => {
            // Ворота расставляем в отрицательном Z (впереди)
            const zPos = -(index + 1) * GATE_DISTANCE;
            this.createGate(zPos, index);
        });

        // Создаем аватар
        if (this.words.length > 0) {
            this.updateAvatar(this.words[0]);
        }
    }

    updateAvatar(word) {
        if (this.avatar) {
            this.worldGroup.remove(this.avatar);
        }

        const emoji = EMOJI_MAP[word] || "❓";
        const texture = this.createEmojiTexture(emoji);
        
        const geometry = new THREE.PlaneGeometry(3, 3);
        const material = new THREE.MeshBasicMaterial({ 
            map: texture, 
            transparent: true,
            side: THREE.DoubleSide
        });
        
        this.avatar = new THREE.Mesh(geometry, material);
        this.avatar.position.set(0, 1.5, 0); // Всегда в центре worldGroup
        
        // Компенсируем поворот мира, чтобы аватар смотрел на камеру
        this.avatar.rotation.y = -this.worldGroup.rotation.y;

        // Если это машина, отражаем её по горизонтали (scale.x = -1), но не забываем про WORLD_SCALE
        if (word === "машина") {
            this.avatar.scale.x = -1 * WORLD_SCALE;
        }

        this.worldGroup.add(this.avatar); // ВАЖНО: Аватар в worldGroup (не движется с дорогой)
        
        this.createParticles(0, 1.5, 0, 0xFFFFFF);
    }

    createEmojiTexture(emoji) {
        const canvas = document.createElement('canvas');
        canvas.width = 256;
        canvas.height = 256;
        const ctx = canvas.getContext('2d');
        ctx.font = '180px Arial';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = 'white';
        ctx.fillText(emoji, 128, 128);
        return new THREE.CanvasTexture(canvas);
    }

    createParticles(x, y, z, color) {
        const particleCount = 30;
        const geometry = new THREE.SphereGeometry(0.15, 4, 4);
        const material = new THREE.MeshBasicMaterial({ color: color });
        
        for (let i = 0; i < particleCount; i++) {
            const mesh = new THREE.Mesh(geometry, material);
            mesh.position.set(x, y, z); // Позиция в worldGroup
            
            mesh.userData.velocity = new THREE.Vector3(
                (Math.random() - 0.5) * 0.3,
                (Math.random() - 0.5) * 0.3,
                (Math.random() - 0.5) * 0.3
            );
            
            this.worldGroup.add(mesh); // Частицы тоже в worldGroup
            this.particles.push(mesh);
        }
    }

    // --- Логика Игры ---

    async loadWords() {
        try {
            const response = await fetch('/words');
            const data = await response.json();
            this.words = data.words;
            this.answers = data.answers;
            
            this.setupLevelEnvironment();
            this.updateUI();
        } catch (error) {
            console.error(error);
        }
    }

    updateUI() {
        if (this.currentIndex < this.words.length) {
            this.currentWordEl.textContent = "Переведи на английский язык: " + this.words[this.currentIndex];
        } else {
            this.currentWordEl.textContent = "🏆 Финиш!";
        }
        
        const progress = (this.currentIndex / this.words.length) * 100;
        this.progressBar.style.width = `${progress}%`;
    }

    async initWebcamAndAudio() {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ 
                video: { facingMode: 'user' },
                audio: { echoCancellation: true, noiseSuppression: true }
            });
            
            this.videoElement.srcObject = stream;
            
            const audioTrack = stream.getAudioTracks()[0];
            const audioStream = new MediaStream([audioTrack]);
            
            this.mediaRecorder = new MediaRecorder(audioStream, { mimeType: 'audio/webm;codecs=opus' });
            
            this.mediaRecorder.ondataavailable = (e) => {
                if (e.data.size > 0) this.audioChunks.push(e.data);
            };
            this.mediaRecorder.onstop = () => this.sendAudioToServer();
            
        } catch (error) {
            console.error(error);
            this.showPopup("Ошибка: Нет доступа к камере/микрофону", false);
        }
    }

    toggleRecording() {
        if (!this.mediaRecorder || this.isMoving) return; 
        
        if (!this.isRecording) {
            this.audioChunks = [];
            this.mediaRecorder.start();
            this.isRecording = true;
            this.recordBtn.textContent = "⏹ Стоп";
            this.recordBtn.classList.add('recording');
        } else {
            this.mediaRecorder.stop();
            this.isRecording = false;
            this.recordBtn.textContent = "🎤 Говорить";
            this.recordBtn.classList.remove('recording');
        }
    }

    async sendAudioToServer() {
        const audioBlob = new Blob(this.audioChunks, { type: 'audio/webm' });
        const formData = new FormData();
        formData.append('audio', audioBlob, 'recording.webm');
        
        this.showPopup("🤔 Слушаю...", null);

        try {
            const response = await fetch('/check_answer', {
                method: 'POST',
                body: formData
            });
            const result = await response.json();
            
            if (result.success) {
                this.validateAnswer(result.normalized);
            } else {
                this.showPopup("Ошибка распознавания", false);
            }
        } catch (error) {
            this.showPopup("Ошибка сети", false);
        }
    }

    validateAnswer(userAnswer) {
        if (this.currentIndex >= this.words.length) return;

        const currentWord = this.words[this.currentIndex];
        const correctAnswer = this.answers[currentWord].toLowerCase();
        
        if (userAnswer === correctAnswer) {
            this.showPopup(`Верно! ${userAnswer}`, true);
            this.startLevelTransition();
        } else {
            this.showPopup(`Нет: ${userAnswer}`, false);
        }
    }

    startLevelTransition() {
        this.isMoving = true;
        
        const currentGate = this.gates[this.currentIndex];
        if (currentGate) {
            currentGate.mesh.material.color.setHex(0x2ecc71); 
            
            // Позиция частиц должна быть там, где ворота СЕЙЧАС находятся в мире
            // Ворота внутри contentGroup.
            // Позиция ворот в worldGroup = contentGroup.position.z + gate.z
            const currentWorldZ = this.contentGroup.position.z + currentGate.z;
            this.createParticles(0, 3, currentWorldZ, 0x2ecc71); 
        }

        // Логика движения: Мы двигаем contentGroup (дорогу) ВПЕРЕД (+Z)
        // Изначально contentGroup.z = 0.
        // Ворота стоят на Z = -40, -80, -120...
        // Чтобы первые ворота (-40) оказались позади игрока (например, на +10),
        // нам нужно сдвинуть contentGroup на +50.
        // TargetZ = -(gate.z) + 10
        
        const startZ = this.contentGroup.position.z;
        const targetZ = -currentGate.z + 10; 
        
        const duration = 2000;
        const startTime = Date.now();

        const animateMove = () => {
            const elapsed = Date.now() - startTime;
            const progress = Math.min(elapsed / duration, 1);
            
            const ease = 1 - Math.pow(1 - progress, 3); 

            // Двигаем дорогу
            this.contentGroup.position.z = startZ + (targetZ - startZ) * ease;

            if (progress < 1) {
                requestAnimationFrame(animateMove);
            } else {
                this.finishLevelTransition();
            }
        };
        
        animateMove();
    }

    finishLevelTransition() {
        this.currentIndex++;
        this.isMoving = false;
        
        if (this.currentIndex < this.words.length) {
            this.updateAvatar(this.words[this.currentIndex]);
            this.updateUI();
        } else {
            this.endGame();
        }
    }

    endGame() {
        this.updateUI();
        
        // 1. Скрываем игровой мир
        this.worldGroup.visible = false;
        
        // 2. Скрываем кнопку записи
        this.recordBtn.style.display = 'none';
        
        // 3. Показываем кнопку рестарта (создаем динамически если нет в HTML)
        let restartBtn = document.getElementById('restartBtn');
        if (!restartBtn) {
            restartBtn = document.createElement('button');
            restartBtn.id = 'restartBtn';
            restartBtn.textContent = '🔄 Попробовать снова';
            restartBtn.style.backgroundColor = '#3498db';
            restartBtn.style.color = 'white';
            restartBtn.onclick = () => location.reload();
            document.querySelector('.controls').appendChild(restartBtn);
        }
        restartBtn.style.display = 'inline-block';

        // 4. Запускаем бесконечный салют
        this.startFireworksLoop();
    }

    startFireworksLoop() {
        // Создаем частицы прямо в сцене (так как worldGroup скрыт)
        const spawnFirework = () => {
            const x = (Math.random() - 0.5) * 20;
            const y = (Math.random() - 0.5) * 10 + 5;
            const z = (Math.random() - 0.5) * 10;
            const color = Math.random() * 0xffffff;
            
            this.createGlobalParticles(x, y, z, color);
        };

        setInterval(spawnFirework, 500);
        spawnFirework(); // Сразу один
    }

    createGlobalParticles(x, y, z, color) {
        const particleCount = 50;
        const geometry = new THREE.SphereGeometry(0.2, 4, 4);
        const material = new THREE.MeshBasicMaterial({ color: color });
        
        for (let i = 0; i < particleCount; i++) {
            const mesh = new THREE.Mesh(geometry, material);
            mesh.position.set(x, y, z);
            
            mesh.userData.velocity = new THREE.Vector3(
                (Math.random() - 0.5) * 0.5,
                (Math.random() - 0.5) * 0.5,
                (Math.random() - 0.5) * 0.5
            );
            
            this.scene.add(mesh);
            this.particles.push(mesh);
        }
    }

    showPopup(text, isSuccess) {
        this.popupEl.textContent = text;
        this.popupEl.className = 'popup-result popup-visible';
        
        if (isSuccess === true) this.popupEl.classList.add('popup-success');
        else if (isSuccess === false) this.popupEl.classList.add('popup-error');
        
        setTimeout(() => {
            this.popupEl.className = 'popup-result';
        }, 2000);
    }

    onWindowResize() {
        if (this.camera && this.renderer) {
            this.camera.aspect = window.innerWidth / window.innerHeight;
            this.camera.updateProjectionMatrix();
            this.renderer.setSize(window.innerWidth, window.innerHeight);
        }
    }

    animate() {
        requestAnimationFrame(() => this.animate());
        
        // Анимация частиц
        this.particles.forEach((p, index) => {
            p.position.add(p.userData.velocity);
            p.scale.multiplyScalar(0.95);
            if (p.scale.x < 0.01) {
                // Пытаемся удалить из родителя (будь то worldGroup или scene)
                if (p.parent) p.parent.remove(p);
                this.particles.splice(index, 1);
            }
        });

        // Анимация парения аватара
        if (this.avatar) {
            this.avatar.position.y = 1.5 + Math.sin(Date.now() * 0.005) * 0.2;
        }

        if (this.renderer && this.scene && this.camera) {
            this.renderer.render(this.scene, this.camera);
        }
    }
}

document.addEventListener('DOMContentLoaded', () => {
    new ARGame();
});