# 🌱 PECH-EYE: Smart Agriculture and Pechay Cultivation System

**An IoT-Based Smart Nursery, Crop Monitoring, and Automated Irrigation System**

---

## 📌 Overview

PECH-EYE is an Internet of Things (IoT)-based smart agriculture system designed to improve pechay (*Brassica rapa*) cultivation through automated environmental monitoring, computer vision, and intelligent water management.

The system integrates ESP32-based microcontrollers, environmental sensors, and camera modules to monitor growing conditions, automate nursery misting, assess plant canopy development, and manage irrigation in an outdoor grow-out bed.

By combining hardware automation, image-based monitoring, and weather data integration, PECH-EYE aims to support more efficient, consistent, and data-driven pechay cultivation.

## 🎯 Project Objectives

- Develop an automated monitoring system for indoor pechay seedling cultivation.
- Monitor environmental conditions through integrated sensors.
- Automate nursery misting based on configured environmental conditions.
- Analyze pechay canopy coverage through camera-based image processing.
- Generate alerts when seedlings reach the required canopy development for transplantation.
- Implement automated irrigation for the outdoor grow-out bed using soil moisture measurements.
- Integrate weather forecast information into irrigation management.
- Improve water and nutrient management through automated system operations.

## ✨ Key Features

| Feature | Description |
|---|---|
| Environmental Monitoring | Collects environmental and growing-condition data through sensors. |
| Automated Nursery Misting | Controls the nursery misting system based on configured conditions. |
| Camera-Based Monitoring | Captures images of pechay plants for canopy analysis. |
| Canopy Coverage Analysis | Evaluates foliage coverage to assess seedling development. |
| Growth Stage Alerts | Notifies users when seedlings meet the target canopy development. |
| Smart Irrigation | Automates outdoor grow-bed irrigation based on soil moisture thresholds. |
| Weather Integration | Uses weather forecast data to support irrigation decisions. |
| System Monitoring | Provides access to sensor readings and system operating status. |

## 🏗️ System Architecture

PECH-EYE is organized into two primary cultivation environments:

### 1. Indoor Nursery System

Responsible for monitoring and maintaining the growing conditions of pechay seedlings.

Main components:
- ESP32 microcontroller
- Environmental sensors
- Water level sensor
- Camera module
- Misting system
- Water reservoir
- LCD monitoring interface

Primary functions:
- Environmental data collection
- Automated misting
- Camera-based canopy monitoring
- Seedling growth assessment
- Transplantation readiness alerts

### 2. Outdoor Grow-Out Bed System

Responsible for monitoring soil conditions and managing irrigation after seedlings are transplanted.

Main components:
- ESP32 microcontroller
- Soil moisture sensors
- Camera module
- Solenoid valve
- Irrigation system
- Weather API integration

Primary functions:
- Soil moisture monitoring
- Automated irrigation control
- Canopy development monitoring
- Weather-assisted irrigation decisions
- Water and nutrient management

## 🛠️ Technologies and Hardware

### Microcontrollers and Processing
- ESP32-S3 Development Board
- ESP32-S3-CAM
- ESP32 Camera Modules

### Sensors and Actuators
- Environmental Sensors
- Soil Moisture Sensors
- Water Level Sensor
- Solenoid Valve
- Misting System
- Relay Modules

### Camera Modules
- OV2640
- OV5640 (depending on deployment)

### Software and Development Tools
- Arduino IDE
- C/C++ (Arduino Framework)
- Python (image processing, if applicable)
- Wi-Fi Communication
- Weather API
- Computer Vision / Image Processing

## 📂 Repository Structure

```text
pech-eye-smart-agriculture-system/
│
├── firmware/
│   ├── nursery/
│   ├── grow-bed/
│   ├── camera/
│   └── shared/
│
├── software/
│   ├── monitoring/
│   ├── image-processing/
│   └── api-integration/
│
├── hardware/
│   ├── wiring-diagrams/
│   ├── pinout/
│   └── components/
│
├── documentation/
│   ├── system-architecture/
│   ├── technical-documentation/
│   └── user-manual/
│
├── tests/
│   ├── sensor-tests/
│   ├── actuator-tests/
│   └── integration-tests/
│
├── .gitignore
└── README.md
```

## 🔄 System Workflow

1. Sensors collect environmental and soil-related data.
2. The microcontrollers process the collected readings.
3. The nursery system activates misting when configured conditions are met.
4. The camera captures plant images for canopy coverage analysis.
5. The system evaluates seedling development and generates transplantation alerts.
6. After transplantation, the grow-out bed system monitors soil moisture.
7. Irrigation is controlled according to configured moisture thresholds and weather information.
8. System readings and operational status are made available for monitoring.

## 🧪 Development Status

**Current Status: In Development**

PECH-EYE is currently undergoing hardware integration, firmware development, sensor calibration, camera testing, and system validation.

Planned development milestones:
- [ ] ESP32-S3 hardware initialization
- [ ] Sensor integration and calibration
- [ ] Nursery misting automation
- [ ] Camera initialization and image capture
- [ ] Canopy coverage analysis
- [ ] Growth stage alert implementation
- [ ] Outdoor irrigation automation
- [ ] Weather API integration
- [ ] System integration and testing

## 📖 Documentation

Technical documentation, hardware configurations, wiring diagrams, and system development references will be maintained in the `documentation/` directory.

## 👥 Project Information

| Category | Details |
|---|---|
| Project Name | PECH-EYE |
| Project Type | Academic Capstone Project |
| Project Domain | Internet of Things (IoT) and Smart Agriculture |
| Primary Crop | Pechay (*Brassica rapa*) |
| Main Platform | ESP32-S3 |
| Development Environment | Arduino IDE |

---

**PECH-EYE — Integrating IoT and intelligent monitoring for smarter pechay cultivation.**

---
All Rights Reserved. 2026. Danel Tungpalan. Sam Jahred Apostol
