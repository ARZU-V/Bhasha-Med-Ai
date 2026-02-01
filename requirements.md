# Requirements: Bhasha AI 🩺

This document outlines the technical prerequisites, infrastructure requirements, and the strategic novelty of the Bhasha AI platform.

---

## 1. Executive Summary & Strategy
Bhasha AI is a high-performance healthcare companion designed for the "Next Billion" users in rural Bharat.

* **End-to-End Goal**: To digitize the rural patient journey—from native-voice triage to automated hospital bookings and medication adherence—eliminating the digital literacy barrier.
* **Novelty & Innovation**: Unlike static chatbots, Bhasha AI is an **Active Agent**. It uses AWS Step Functions to bridge the digital-physical gap by making outbound hospital calls and extracting medication schedules from physical prescriptions via AI Vision.
* **Usefulness & Viability**: By choosing **Golang** and **Serverless AWS**, we achieve industry-leading concurrency at a cost of less than **$0.03 per patient session**, making it financially viable for large-scale rural rollout.
* **Market Impact**: Targeting 900M+ rural Indians who average 3 doctor visits annually, with 70% of elderly having chronic conditions requiring frequent monitoring.
* **Responsibility**: Built with **AWS HealthLake**, the system is architected for **ABHA (Ayushman Bharat)** compliance, ensuring top-tier data security and clinical responsibility.

---

## 2. Example Use Cases

### **Case A: The Multilingual Triage (Remote Village)**
* **User**: An elderly farmer with limited literacy.
* **Action**: He speaks to the app in his native dialect (e.g., Gondi or Marathi) about a persistent cough. 
* **Process**: **Amazon Transcribe** identifies the dialect; **Bedrock** analyzes the symptoms and determines it's a high-priority respiratory issue.
* **Outcome**: The app automatically ranks nearby clinics and provides a voice-guided "Next Step."

### **Case B: The Autonomous Booking Agent**
* **User**: A mother whose child has a high fever.
* **Action**: She selects a recommended pediatrician from the **AWS Location Service** map.
* **Process**: The **Go-backend** triggers an **AWS Step Function**. The AI Agent initiates an outbound call via **Amazon Connect** to the clinic's receptionist, speaks in the local language, and confirms a slot.
* **Outcome**: The mother receives a confirmation SMS and a voice reminder.

### **Case C: Prescription Vision & Adherence**
* **User**: A patient returning home with a handwritten prescription.
* **Action**: The user takes a photo of the prescription or medicine strips.
* **Process**: **Bedrock Vision** extracts the dosage (e.g., "1-0-1 after food"). 
* **Outcome**: The app sets automatic **DynamoDB-backed** alarms that play voice reminders: *"It is time to take your blue tablet."*

---

## 3. Technical Stack & Development Environment
* **Go (Golang) v1.21+**: High-concurrency backend engine.
* **Node.js v18.x+**: For the React Native/Expo frontend.
* **Expo CLI**: For mobile application bundling and testing.
* **AWS CLI**: Configured with IAM credentials.
* **Docker**: For containerizing the Go microservices.

---

## 4. AWS Infrastructure Dependencies
* **Amazon Bedrock**: Access to **Claude 3.5 Sonnet** (Reasoning & Vision).
* **Amazon Transcribe & Polly**: Regional Speech-to-Text and Voice-out.
* **AWS Step Functions**: Orchestrating the booking and SOS state machines.
* **AWS App Runner**: Hosting the Go microservices.
* **Amazon DynamoDB**: Storage for history, alarms, and sessions.
* **AWS HealthLake**: Synchronization with ABHA medical records.
* **AWS Location Service**: Proximity ranking and hospital mapping.

---

## 5. Environment Variables (`.env`)
```bash
# AWS Infrastructure
AWS_ACCESS_KEY_ID=your_access_key
AWS_SECRET_ACCESS_KEY=your_secret_key
AWS_REGION=ap-south-1

# Project Specifics
DYNAMODB_TABLE_NAME=BhashaAI_Data
S3_BUCKET_NAME=bhasha-ai-scans
BEDROCK_MODEL_ID=anthropic.claude-3-5-sonnet-v1:0

# External Integration
ABDM_CLIENT_ID=your_abdm_sandbox_id
HOSPITAL_API_KEY=hospital_booking_gateway_token
```

---

## 6. Success Metrics & Market Analysis

### **Target Market Sizing**
* **Primary Users**: 900M+ rural Indians with limited digital literacy
* **Healthcare Frequency**: Average 3 doctor visits per year (urban: 4.8, rural: 2.7)
* **Elderly Care Gap**: 70% of seniors (60+) have chronic conditions, 59% used outpatient services
* **Geographic Challenge**: Average 14.5km distance to healthcare facilities in rural areas

### **Measurable Success Criteria**
* **Accessibility**: Reduce appointment booking time from 2-3 hours to under 10 minutes
* **Language Barrier**: Support 15+ Indian dialects with 95%+ transcription accuracy
* **Cost Efficiency**: Maintain operational cost under $0.03 per patient session
* **Adoption Rate**: Target 100K+ rural users within first 6 months of deployment
* **Health Outcomes**: 40% reduction in missed appointments through automated reminders

### **Cost Analysis Breakdown**
```
Per Session Cost Calculation (Based on 3 visits/year/user):
- AWS Transcribe: $0.0048 per minute (avg 5-min session) = $0.024
- Bedrock Claude 3.5: $0.003 per 1K tokens (avg 2K tokens) = $0.006
- DynamoDB: $0.00013 per read/write operation = $0.0001
- Step Functions: $0.000025 per state transition = $0.0001
- Total per session: $0.0302

Annual cost per user (3 sessions): $0.09
Revenue model: Government subsidy + NGO partnerships
Break-even: 50K active users
```

### **Technical Feasibility Metrics**
* **Concurrency**: Handle 10,000+ simultaneous voice sessions via Go routines
* **Latency**: Sub-2 second response time for triage recommendations
* **Availability**: 99.9% uptime using AWS multi-AZ deployment
* **Scalability**: Auto-scale from 100 to 100,000 users without architecture changes