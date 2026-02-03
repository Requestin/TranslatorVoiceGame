class LanguageLearningGame {
    constructor() {
        this.words = [];
        this.answers = {};
        this.currentIndex = 0;
        this.isRecording = false;
        this.mediaRecorder = null;
        this.audioChunks = [];
        
        this.initElements();
        this.initMicrophone();
        this.loadWords();
    }
    
    initElements() {
        this.currentWordEl = document.getElementById('currentWord');
        this.recordBtn = document.getElementById('recordBtn');
        this.nextBtn = document.getElementById('nextBtn');
        this.resultEl = document.getElementById('result');
        this.progressBar = document.getElementById('progressBar');
        this.wordListEl = document.getElementById('wordList');
        
        this.recordBtn.addEventListener('click', () => this.toggleRecording());
        this.nextBtn.addEventListener('click', () => this.nextWord());
    }
    
    async loadWords() {
        try {
            const response = await fetch('/words');
            const data = await response.json();
            
            this.words = data.words;
            this.answers = data.answers;
            
            this.updateWordList();
            this.showCurrentWord();
            this.updateProgress();
        } catch (error) {
            this.showError('Не удалось загрузить слова');
        }
    }
    
    updateWordList() {
        this.wordListEl.innerHTML = this.words.map(word => 
            `${word} → <strong>${this.answers[word]}</strong>`
        ).join('<br>');
    }
    
    showCurrentWord() {
        if (this.currentIndex < this.words.length) {
            this.currentWordEl.textContent = this.words[this.currentIndex];
            this.nextBtn.disabled = true;
            this.clearResult();
        } else {
            this.currentWordEl.textContent = "🎉 Все слова пройдены!";
            this.recordBtn.disabled = true;
            this.nextBtn.disabled = true;
        }
    }
    
    updateProgress() {
        const progress = ((this.currentIndex) / this.words.length) * 100;
        this.progressBar.style.width = `${progress}%`;
    }
    
    async initMicrophone() {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ 
                audio: {
                    echoCancellation: true,
                    noiseSuppression: true,
                    sampleRate: 16000
                }
            });
            
            this.mediaRecorder = new MediaRecorder(stream, {
                mimeType: 'audio/webm;codecs=opus'
            });
            
            this.mediaRecorder.ondataavailable = (event) => {
                if (event.data.size > 0) {
                    this.audioChunks.push(event.data);
                }
            };
            
            this.mediaRecorder.onstop = () => this.sendAudioToServer();
            
        } catch (error) {
            this.showError('Не удалось получить доступ к микрофону. Разрешите доступ и обновите страницу.');
            this.recordBtn.disabled = true;
        }
    }
    
    toggleRecording() {
        if (!this.mediaRecorder) {
            this.showError('Микрофон не инициализирован');
            return;
        }
        
        if (!this.isRecording) {
            this.startRecording();
        } else {
            this.stopRecording();
        }
    }
    
    startRecording() {
        this.audioChunks = [];
        this.mediaRecorder.start();
        this.isRecording = true;
        this.recordBtn.textContent = "⏹ Остановить запись";
        this.recordBtn.classList.add('recording');
        this.clearResult();
        this.showInfo('Запись началась... Говорите четко и ясно');
    }
    
    stopRecording() {
        if (this.mediaRecorder.state === 'recording') {
            this.mediaRecorder.stop();
        }
        this.isRecording = false;
        this.recordBtn.textContent = "🎤 Нажмите и говорите";
        this.recordBtn.classList.remove('recording');
        this.showInfo('Обработка аудио...');
    }
    
    async sendAudioToServer() {
        try {
            const audioBlob = new Blob(this.audioChunks, { type: 'audio/webm' });
            const formData = new FormData();
            formData.append('audio', audioBlob, 'recording.webm');
            
            const response = await fetch('/check_answer', {
                method: 'POST',
                body: formData
            });
            
            const result = await response.json();
            
            if (result.success) {
                this.checkAnswer(result.normalized);
            } else {
                this.showError(`Ошибка распознавания: ${result.message || 'Неизвестная ошибка'}`);
            }
            
        } catch (error) {
            this.showError(`Ошибка сети: ${error.message}`);
        }
    }
    
    checkAnswer(userAnswer) {
        const currentWord = this.words[this.currentIndex];
        const correctAnswer = this.answers[currentWord].toLowerCase();
        
        // Простое сравнение нормализованных строк
        if (userAnswer === correctAnswer) {
            this.showSuccess(`Верно! "${currentWord}" → "${correctAnswer}"`);
            this.nextBtn.disabled = false;
        } else {
            this.showError(`Неправильно. Вы сказали: "${userAnswer}". Попробуйте еще раз.`);
        }
    }
    
    nextWord() {
        this.currentIndex++;
        this.updateProgress();
        this.showCurrentWord();
    }
    
    showSuccess(message) {
        this.resultEl.className = 'result success';
        this.resultEl.innerHTML = `✅ ${message}`;
    }
    
    showError(message) {
        this.resultEl.className = 'result error';
        this.resultEl.innerHTML = `❌ ${message}`;
    }
    
    showInfo(message) {
        this.resultEl.className = 'result info';
        this.resultEl.innerHTML = `ℹ️ ${message}`;
    }
    
    clearResult() {
        this.resultEl.className = 'result';
        this.resultEl.innerHTML = '';
    }
}

// Инициализация игры при загрузке страницы
document.addEventListener('DOMContentLoaded', () => {
    new LanguageLearningGame();
});