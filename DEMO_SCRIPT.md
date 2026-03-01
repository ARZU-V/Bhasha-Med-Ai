# Bhasha AI — 3-Minute Hackathon Demo Script

> **Format:** Screen recording + voiceover | **Target:** 3:00 flat
> **Tone:** Confident, urgent, human — not a feature tour, a story.

---

## 🎬 HOOK — 0:00 to 0:20 (20 seconds)

**[Show plain black screen, then a stat fades in]**

> *"600 million Indians need medical care every year.
> Most of them can't explain their symptoms in English.
> Most of them can't navigate a hospital website.
> Most of them can't make a phone call to book a doctor — in the middle of an emergency.*
>
> *We built Bhasha AI to fix that."*

**[App opens on phone mockup — clean, fast]**

---

## 🗣️ ACT 1 — Voice AI in Any Language — 0:20 to 0:55 (35 seconds)

**[Show VoiceTab open. Tap mic. Speak in Hindi.]**

> *"Watch. I tap the mic and speak in Hindi — a language 530 million Indians speak daily."*

**[Speak]: "मुझे बुखार है और सिर में बहुत दर्द हो रहा है"**
*(I have a fever and a severe headache)*

> *"Bhasha AI is powered by Amazon Bedrock — Claude running on AWS infrastructure.
> It understands the language, identifies the medical intent, and responds in Hindi — with audio.*
>
> *And here's the agentic part — it decides what to do next."*

**[AI responds and the app automatically navigates to Hospitals tab]**

> *"Mild symptoms? It routes you to the nearest hospital map automatically.
> No button tapped. No menu navigated. The AI agent decided."*

---

## 🏥 ACT 2 — Booking with AI Agent Phone Call — 0:55 to 1:40 (45 seconds)

**[Switch back. Speak again.]**

**[Speak]:** *"I need to book an appointment with a cardiologist for chest pain"*

> *"Serious symptoms. Different intent. Watch what happens."*

**[App auto-navigates to Appointments tab, form pre-filled]**

> *"The AI extracted the doctor type, the urgency — and pre-filled the booking form.
> Now I hit Book.*
>
> *This is where Bhasha AI does something no other health app does.*
>
> *It makes a real phone call — right now — to the clinic.
> Not a WhatsApp message. Not an email. An actual outbound call.*
>
> *Powered by Exotel + AWS Lambda — a serverless agent that dials the clinic,
> and when they pick up, speaks on my behalf."*

**[Show phone ringing animation on screen + real phone ringing in frame if possible]**

> *"The clinic answers. They hear:*
> 'Hello. This is Bhasha AI. I am calling on behalf of Arjit Singh to request an appointment
> with a cardiologist. The preferred time is tomorrow morning.
> Please call the patient back at their number to confirm.'*
>
> *The patient never had to speak to anyone.*
> *The clinic gets a clear, professional booking request.*
> *Done."*

---

## 🆘 ACT 3 — Emergency SOS — 1:40 to 2:15 (35 seconds)

**[Tap Emergency tab]**

> *"Now the scariest scenario. A medical emergency.*
>
> *One tap. That's all it takes."*

**[Tap SOS button — 30-second countdown starts]**

> *"Bhasha AI triggers three things simultaneously via AWS:*
>
> *One — it captures GPS location using the browser Geolocation API
> and stores the emergency record in Amazon DynamoDB.*
>
> *Two — it initiates outbound calls to every emergency contact
> via Exotel + AWS Lambda. When they answer, they hear an urgent voice alert
> with the patient's name, exact location, and a callback number.*
>
> *Three — if the call fails, Amazon SNS fires an SMS fallback automatically.*
>
> *All of this happens in under 2 seconds."*

**[Show the contacts being called on screen]**

> *"This isn't a notification. This is an AI agent actively fighting for your life."*

---

## ☁️ ACT 4 — AWS Architecture (Quick) — 2:15 to 2:40 (25 seconds)

**[Show architecture diagram — clean AWS icons]**

> *"The entire stack runs on AWS:*
>
> - **Amazon Bedrock** — Claude foundation model for multilingual medical AI
> - **Amazon Polly** — Neural TTS voices in 6 Indian languages
> - **AWS Lambda** — 8 serverless functions, zero infrastructure to manage
> - **Amazon API Gateway** — REST API with CORS, deployed to production
> - **Amazon DynamoDB** — Real-time call status, user profiles, health records
> - **Amazon S3** — Audio storage for voice responses
> - **Amazon SNS** — SMS fallback for emergency alerts*
>
> *Fully serverless. Scales to millions of users. Costs near zero at rest."*

---

## 🏁 CLOSE — 2:40 to 3:00 (20 seconds)

**[Return to app homescreen — elegant, full UI]**

> *"Bhasha AI is not a chatbot.*
> *It's not a symptom checker.*
> *It is an autonomous medical agent — that speaks your language,
> calls your doctor, and alerts your family — so you don't have to.*
>
> *Built entirely on AWS. Built for 1.4 billion people.*
>
> *Bhasha AI."*

**[Hold on logo/app name — fade to black]**

---

## 📋 RECORDING CHECKLIST

- [ ] App running at `localhost:3001` — profile set (name: your real name)
- [ ] Voice tab — speak Hindi phrase clearly, wait for AI response + auto-navigate
- [ ] Appointments tab — fill form, click Book, keep phone in frame to show real call
- [ ] Emergency tab — tap SOS (cancel before 30s countdown ends)
- [ ] Architecture slide ready as a PNG to flash for 10 seconds
- [ ] Record at 1080p, export under 500MB for upload

## 🎯 AWS BUZZWORDS TO HIT (judges scan for these)

✅ Amazon Bedrock · AWS Lambda · Amazon API Gateway · Amazon DynamoDB
✅ Amazon Polly · Amazon SNS · Amazon S3 · Serverless architecture
✅ Generative AI · Foundation Models · Agentic AI · Real-time inference
✅ Event-driven · Scalable · Managed services · Production-deployed
