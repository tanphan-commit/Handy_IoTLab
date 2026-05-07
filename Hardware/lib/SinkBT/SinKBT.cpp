#include "SinkBT.h"

#define SERVICE_UUID        "12345678-1234-1234-1234-1234567890ab"
#define CHARACTERISTIC_UUID "abcd1234-1234-1234-1234-abcdef123456"
//testgit
SinkBTServerCallbacks::SinkBTServerCallbacks(SinkBT *owner) {
  _owner = owner;
}

void SinkBTServerCallbacks::onConnect(BLEServer *server) {
  _owner->_connected = true;
}

void SinkBTServerCallbacks::onDisconnect(BLEServer *server) {
  _owner->_connected = false;

  delay(200);
  server->getAdvertising()->start();
}

SinkBT::SinkBT() {}

void SinkBT::begin(String deviceName) {
  BLEDevice::init(deviceName.c_str());

  BLEDevice::setMTU(185);

  _server = BLEDevice::createServer();
  _server->setCallbacks(new SinkBTServerCallbacks(this));

  _service = _server->createService(SERVICE_UUID);

  _characteristic = _service->createCharacteristic(
    CHARACTERISTIC_UUID,
    BLECharacteristic::PROPERTY_READ |
    BLECharacteristic::PROPERTY_NOTIFY
  );

  _characteristic->addDescriptor(new BLE2902());

  _characteristic->setValue("ESP32 Soil Sensor Ready");

  _service->start();

  BLEAdvertising *advertising = BLEDevice::getAdvertising();
  advertising->addServiceUUID(SERVICE_UUID);
  advertising->setScanResponse(true);
  advertising->setMinPreferred(0x06);
  advertising->setMinPreferred(0x12);

  BLEDevice::startAdvertising();

  Serial.println("[BLE] Started advertising");
  Serial.print("[BLE] Device name: ");
  Serial.println(deviceName);
}

bool SinkBT::CheckConnection() {
  if (_connected != _lastConnected) {
    _lastConnected = _connected;

    if (_connected) {
      Serial.println("[BLE] Device connected");
    } else {
      Serial.println("[BLE] Device disconnected");
    }
  }

  return _connected;
}

bool SinkBT::hasClient() {
  return _connected;
}

void SinkBT::SendSoilJson(
  float moisture,
  float temperature,
  uint16_t ec,
  float ph,
  uint16_t nitrogen,
  uint16_t phosphorus,
  uint16_t potassium
) {
  if (!_connected || _characteristic == nullptr) {
    return;
  }

  String json = "{";
  json += "\"status\":\"ok\",";
  json += "\"moisture\":" + String(moisture, 1) + ",";
  json += "\"temperature\":" + String(temperature, 1) + ",";
  json += "\"ec\":" + String(ec) + ",";
  json += "\"ph\":" + String(ph, 2) + ",";
  json += "\"n\":" + String(nitrogen) + ",";
  json += "\"p\":" + String(phosphorus) + ",";
  json += "\"k\":" + String(potassium);
  json += "}";

  _characteristic->setValue(json.c_str());
  _characteristic->notify();

  Serial.print("[BLE] Sent: ");
  Serial.println(json);
}

void SinkBT::SendErrorJson(String message) {
  if (!_connected || _characteristic == nullptr) {
    return;
  }

  String json = "{";
  json += "\"status\":\"error\",";
  json += "\"message\":\"" + message + "\"";
  json += "}";

  _characteristic->setValue(json.c_str());
  _characteristic->notify();

  Serial.print("[BLE] Sent: ");
  Serial.println(json);
}