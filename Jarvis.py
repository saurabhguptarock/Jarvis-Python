import speech_recognition as sr
import pyttsx3
import time

recognizer = sr.Recognizer()
engine = pyttsx3.init()


def speak(text):
    engine.say(text)
    engine.runAndWait()


with sr.Microphone() as source:
    print("Say Something")
    while True:
        audio = recognizer.listen(source)
        try:
            txt = recognizer.recognize_google(audio)
            if txt == "how are you":
                speak("I am good")
        except Exception:
            print("Cannot Recognize")
            speak("Please try again")
