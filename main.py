from fastapi import FastAPI, HTTPException, UploadFile, File
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from huggingface_hub import InferenceClient
import httpx
import os
from dotenv import load_dotenv
import tempfile
import io
import struct

# Загружаем токен из .env файла
load_dotenv()
HF_TOKEN = os.getenv("HF_TOKEN")
if not HF_TOKEN:
    print("⚠️  Предупреждение: HF_TOKEN не найден в .env файле!")

app = FastAPI(title="Language Learning Prototype")

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Для прототипа разрешаем все
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Монтируем папку со статическими файлами
app.mount("/static", StaticFiles(directory="static"), name="static")

# Словарь с правильными ответами
WORDS = {
    "кошка": "cat",
    "собака": "dog", 
    "дом": "house",
    "машина": "car",
    "мама": "mother"
}

def convert_webm_to_flac(webm_bytes: bytes) -> bytes:
    """
    Конвертирует WebM в FLAC (16kHz, mono) - формат из официальных примеров
    """
    try:
        # Создаем временный WebM файл
        with tempfile.NamedTemporaryFile(suffix='.webm', delete=False) as webm_tmp:
            webm_tmp.write(webm_bytes)
            webm_path = webm_tmp.name
        
        # Конвертируем через pydub (требует ffmpeg)
        from pydub import AudioSegment
        
        audio = AudioSegment.from_file(webm_path, format="webm")
        audio = audio.set_frame_rate(16000).set_channels(1)
        
        # Экспортируем в FLAC (не WAV!)
        flac_io = io.BytesIO()
        audio.export(flac_io, format="flac")
        flac_bytes = flac_io.getvalue()
        
        # Очистка
        os.unlink(webm_path)
        
        print(f"🔄 Конвертировано WebM->FLAC: {len(webm_bytes)} -> {len(flac_bytes)} байт")
        return flac_bytes
        
    except Exception as e:
        print(f"❌ Ошибка конвертации: {e}")
        # В крайнем случае, возвращаем оригинальный WebM
        # API может принять audio/webm согласно списку поддерживаемых типов
        return webm_bytes

def normalize_text(text: str) -> str:
    """
    Нормализует текст для сравнения
    """
    # Приводим к нижнему регистру, удаляем знаки препинания и лишние пробелы
    import re
    text = text.lower().strip()
    text = re.sub(r'[^\w\s]', '', text)  # Удаляем знаки препинания
    text = re.sub(r'\s+', ' ', text)      # Заменяем множественные пробелы
    return text

@app.get("/", response_class=HTMLResponse)
async def get_home():
    """
    Отдает главную страницу
    """
    with open("static/index.html", "r", encoding="utf-8") as f:
        return HTMLResponse(content=f.read())

@app.get("/words")
async def get_words():
    """
    Возвращает список слов для изучения
    """
    return {"words": list(WORDS.keys()), "answers": WORDS}

@app.post("/check_answer")
async def check_answer(audio: UploadFile = File(...)):
    """
    Проверяет произношение пользователя через рабочий Inference API
    """
    import tempfile
    import os
    
    try:
        print(f"🔊 Получен аудиофайл: {audio.filename}, {audio.content_type}")
        
        # 1. Читаем и конвертируем аудио WebM -> FLAC
        audio_bytes = await audio.read()
        print(f"📦 Размер исходного аудио: {len(audio_bytes)} байт")
        
        flac_bytes = convert_webm_to_flac(audio_bytes)
        
        # 2. СОЗДАЕМ ВРЕМЕННЫЙ ФАЙЛ FLAC (ключевое изменение!)
        with tempfile.NamedTemporaryFile(suffix='.flac', delete=False) as tmp:
            tmp.write(flac_bytes)
            tmp_path = tmp.name

        print(f"📁 Создан временный файл: {tmp_path} ({len(flac_bytes)} байт)")
        
        try:
            # 3. Инициализируем клиент с указанием провайдера
            client = InferenceClient(
                provider="hf-inference",
                api_key=HF_TOKEN
            )
            
            # 4. ПЕРЕДАЕМ ПУТЬ К ФАЙЛУ (как в официальном примере)
            # Клиент сам установит правильный Content-Type
            result = client.automatic_speech_recognition(
                tmp_path,  # Передаем путь к файлу, не байты!
                model="openai/whisper-large-v3-turbo"
            )
            
            # 5. Получаем текст
            if hasattr(result, 'text'):
                transcribed_text = result.text
            else:
                transcribed_text = str(result)
            
            transcribed_text = transcribed_text.strip()
            print(f"✅ Распознанный текст: '{transcribed_text}'")
            
            if not transcribed_text:
                return {
                    "success": False,
                    "message": "Не удалось распознать речь",
                    "transcribed": ""
                }
            
            # 6. Нормализация
            normalized = normalize_text(transcribed_text)
            
            return {
                "success": True,
                "transcribed": transcribed_text,
                "normalized": normalized
            }
            
        except Exception as e:
            print(f"❌ Ошибка при вызове automatic_speech_recognition: {e}")
            return {
                "success": False,
                "message": f"Ошибка вызова API: {str(e)}",
                "transcribed": ""
            }
            
        finally:
            # 7. Очистка временного файла
            if os.path.exists(tmp_path):
                os.unlink(tmp_path)
                print(f"🧹 Временный файл удален")
                
    except Exception as e:
        print(f"💥 Общая ошибка в check_answer: {e}")
        import traceback
        traceback.print_exc()
        return {
            "success": False,
            "message": f"Внутренняя ошибка сервера: {str(e)}",
            "transcribed": ""
        }

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)