#ifndef SINK_BT_H
#define SINK_BT_H

#include <Arduino.h>
#include <BLEDevice.h>
#include <BLEUtils.h>
#include <BLEServer.h>
#include <BLE2902.h>


class SinkBT;

class SinkBTServerCallbacks : public BLEServerCallbacks {
public:
  SinkBTServerCallbacks(SinkBT *owner);

  void onConnect(BLEServer *server) override;
  void onDisconnect(BLEServer *server) override;

private:
  SinkBT *_owner;
};

class SinkBT {
public:
  SinkBT();

  void begin(String deviceName);

  bool CheckConnection();

  bool hasClient();

  void SendSoilJson(
    float moisture,
    float temperature,
    uint16_t ec,
    float ph,
    uint16_t nitrogen,
    uint16_t phosphorus,
    uint16_t potassium
  );

  void SendErrorJson(String message);

private:
  BLEServer *_server = nullptr;
  BLEService *_service = nullptr;
  BLECharacteristic *_characteristic = nullptr;

  bool _connected = false;
  bool _lastConnected = false;

  friend class SinkBTServerCallbacks;
};

#endif