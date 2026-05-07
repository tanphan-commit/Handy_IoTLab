#include <Arduino.h>
#include <ModbusMaster.h>
#include "SinkBT.h"

#define RXD2 16
#define TXD2 17

#define SENSOR_ID 1
#define MODBUS_BAUDRATE 9600

#define READ_INTERVAL_MS 2000
#define MODBUS_RETRY 3
#define BETWEEN_REQUEST_DELAY_MS 120

ModbusMaster node;
SinkBT BT;

struct SoilData {
  float moisture;
  float temperature;
  uint16_t ec;
  float ph;
  uint16_t nitrogen;
  uint16_t phosphorus;
  uint16_t potassium;
  bool valid;
};

SoilData soil = {0, 0, 0, 0, 0, 0, 0, false};

void clearSerial2Buffer() {
  while (Serial2.available()) {
    Serial2.read();
  }
}

bool modbusReadHolding(uint16_t startAddress, uint16_t quantity) {
  for (uint8_t attempt = 1; attempt <= MODBUS_RETRY; attempt++) {
    clearSerial2Buffer();

    uint8_t result = node.readHoldingRegisters(startAddress, quantity);

    if (result == node.ku8MBSuccess) {
      return true;
    }

    Serial.print("Modbus read failed. Address: 0x");
    Serial.print(startAddress, HEX);
    Serial.print(" Quantity: ");
    Serial.print(quantity);
    Serial.print(" Attempt: ");
    Serial.print(attempt);
    Serial.print("/");
    Serial.print(MODBUS_RETRY);
    Serial.print(" Error: ");
    Serial.println(result);

    delay(BETWEEN_REQUEST_DELAY_MS);
  }

  return false;
}

bool readMainSoilRegisters(SoilData &data) {
  bool ok = modbusReadHolding(0x0000, 7);

  if (!ok) {
    data.valid = false;
    return false;
  }

  uint16_t moisture_raw = node.getResponseBuffer(0);
  int16_t temp_raw      = (int16_t)node.getResponseBuffer(1);
  uint16_t ec_raw       = node.getResponseBuffer(2);
  uint16_t ph_raw       = node.getResponseBuffer(3);
  uint16_t n_raw        = node.getResponseBuffer(4);
  uint16_t p_raw        = node.getResponseBuffer(5);
  uint16_t k_raw        = node.getResponseBuffer(6);

  data.moisture = moisture_raw / 10.0;
  data.temperature = temp_raw / 10.0;
  data.ec = ec_raw;
  data.ph = ph_raw / 100.0;
  data.nitrogen = n_raw;
  data.phosphorus = p_raw;
  data.potassium = k_raw;
  data.valid = true;

  return true;
}

bool readSoilSensor(SoilData &data) {
  data.valid = false;

  bool mainOk = readMainSoilRegisters(data);

  if (!mainOk) {
    return false;
  }

  return true;
}

void printSoilData(const SoilData &data) {
  Serial.println("===== SOIL DATA =====");

  if (!data.valid) {
    Serial.println("Sensor read failed");
    Serial.println("---------------------");
    return;
  }

  Serial.print("Moisture: ");
  Serial.print(data.moisture, 1);
  Serial.println(" %");

  Serial.print("Temperature: ");
  Serial.print(data.temperature, 1);
  Serial.println(" C");

  Serial.print("EC: ");
  Serial.print(data.ec);
  Serial.println(" uS/cm");

  Serial.print("pH: ");
  Serial.println(data.ph, 2);

  Serial.print("N: ");
  Serial.print(data.nitrogen);
  Serial.println(" mg/kg");

  Serial.print("P: ");
  Serial.print(data.phosphorus);
  Serial.println(" mg/kg");

  Serial.print("K: ");
  Serial.print(data.potassium);
  Serial.println(" mg/kg");

  Serial.println("---------------------");
}

void setup() {
  Serial.begin(115200);
  delay(1000);

  Serial2.setRxBufferSize(256);
  Serial2.begin(MODBUS_BAUDRATE, SERIAL_8N1, RXD2, TXD2);

  node.begin(SENSOR_ID, Serial2);

  Serial.println("ESP32 Soil Sensor Start - Auto RS485 Module");

  BT.begin("ESP32_SOIL_SENSOR");
}

void loop() {
  static uint32_t lastReadTime = 0;

  BT.CheckConnection();

  if (millis() - lastReadTime >= READ_INTERVAL_MS) {
    lastReadTime = millis();

    bool ok = readSoilSensor(soil);

    if (!ok) {
      soil.valid = false;
    }

    printSoilData(soil);

    if (BT.hasClient()) {
      if (soil.valid) {
        BT.SendSoilJson(
          soil.moisture,
          soil.temperature,
          soil.ec,
          soil.ph,
          soil.nitrogen,
          soil.phosphorus,
          soil.potassium
        );
      } else {
        BT.SendErrorJson("sensor_read_failed");
      }
    }
  }
}