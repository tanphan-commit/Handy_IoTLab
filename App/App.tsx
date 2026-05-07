import React, {useEffect, useRef, useState} from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  PermissionsAndroid,
  Platform,
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import type {ImageSourcePropType} from 'react-native';
import {BleManager, Device} from 'react-native-ble-plx';
import {decode as decodeBase64} from 'base-64';

/*
  UUID phải khớp với ESP32 BLE
*/
const SERVICE_UUID = '12345678-1234-1234-1234-1234567890ab';
const CHARACTERISTIC_UUID = 'abcd1234-1234-1234-1234-abcdef123456';

/*
  Tên ESP32 trong code:
  BT.begin("ESP32_SOIL_SENSOR");
*/
const DEVICE_NAME_FILTER = 'ESP32';

/*
  Nếu có logo CTU, tạo thư mục assets rồi đổi thành:
  const SCHOOL_LOGO: ImageSourcePropType = require('./assets/logo.png');
*/
const SCHOOL_LOGO: ImageSourcePropType = require('./assets/CTU_logo.png');

/*
  Tạo BleManager bên ngoài component để không bị tạo/hủy lại.
*/
const bleManager = new BleManager();

type SoilData = {
  temperature: number | null;
  humidity: number | null;
  ph: number | null;
  nitrogen: number | null;
  phosphorus: number | null;
  potassium: number | null;
  ec: number | null;
  battery: number | null;
};

const initialSoilData: SoilData = {
  temperature: null,
  humidity: null,
  ph: null,
  nitrogen: null,
  phosphorus: null,
  potassium: null,
  ec: null,
  battery: null,
};

const toNumber = (...values: any[]) => {
  const found = values.find(
    value => value !== undefined && value !== null && value !== '',
  );

  if (found === undefined) {
    return null;
  }

  const numberValue = Number(found);
  return Number.isFinite(numberValue) ? numberValue : null;
};

const formatValue = (value: number | null, digits = 1) => {
  if (value === null || value === undefined) {
    return '--';
  }

  if (Number.isInteger(value)) {
    return String(value);
  }

  return value.toFixed(digits).replace(/\.?0+$/, '');
};

const normalizeSensorData = (json: any, previous: SoilData): SoilData => {
  return {
    temperature:
      toNumber(json.t, json.temp, json.temperature, json.soilTemp) ??
      previous.temperature,

    humidity:
      toNumber(
        json.m,
        json.moisture,
        json.h,
        json.hum,
        json.humidity,
        json.soilHumidity,
      ) ?? previous.humidity,

    ph: toNumber(json.ph, json.pH, json.soilPh) ?? previous.ph,

    nitrogen:
      toNumber(json.n, json.N, json.nitrogen, json.nito) ??
      previous.nitrogen,

    phosphorus:
      toNumber(json.p, json.P, json.phosphorus, json.photpho) ??
      previous.phosphorus,

    potassium:
      toNumber(json.k, json.K, json.potassium, json.kali) ??
      previous.potassium,

    ec: toNumber(json.ec, json.EC, json.conductivity) ?? previous.ec,

    battery:
      toNumber(json.bat, json.b, json.battery, json.pin, json.batteryPercent) ??
      previous.battery,
  };
};

type MetricCardProps = {
  title: string;
  value: number | null;
  unit: string;
  icon: string;
  digits?: number;
  progress?: number | null;
};

function MetricCard({
  title,
  value,
  unit,
  icon,
  digits = 1,
}: MetricCardProps) {
  return (
    <View style={styles.metricCardWrapper}>
      <View style={styles.metricCard}>
        <View style={styles.metricTop}>
          <View style={styles.iconBox}>
            <Text style={styles.iconText}>{icon}</Text>
          </View>

          <View style={styles.metricInfo}>
            <Text style={styles.metricTitle}>{title}</Text>
            
          </View>
        </View>

        <View style={styles.metricValueRow}>
          <Text style={styles.metricValue}>{formatValue(value, digits)}</Text>
          <Text style={styles.metricUnit}>{unit}</Text>
        </View>
      </View>
    </View>
  );
}

export default function App() {
  const monitorSubscription = useRef<{remove: () => void} | null>(null);
  const receiveBuffer = useRef('');
  const scanTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [devices, setDevices] = useState<Device[]>([]);
  const [connectedDevice, setConnectedDevice] = useState<Device | null>(null);
  const [isScanning, setIsScanning] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState('Chưa kết nối');
  const [warningMessage, setWarningMessage] = useState<string | null>(null);
  const [lastUpdate, setLastUpdate] = useState('--:--:--');
  const [lastRawData, setLastRawData] = useState('Chưa có dữ liệu');
  const [soilData, setSoilData] = useState<SoilData>(initialSoilData);

  useEffect(() => {
    return () => {
      monitorSubscription.current?.remove();

      if (scanTimeoutRef.current) {
        clearTimeout(scanTimeoutRef.current);
      }

      try {
        bleManager.stopDeviceScan();
      } catch (error) {
        console.log('Stop scan cleanup error:', error);
      }

      /*
        Không gọi bleManager.destroy() ở đây.
      */
    };
  }, []);

  const requestBluetoothPermissions = async () => {
    if (Platform.OS !== 'android') {
      return true;
    }

    try {
      if (Number(Platform.Version) >= 31) {
        const permissions = [
          PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
          PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
          PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
        ];

        const result = await PermissionsAndroid.requestMultiple(permissions);

        return Object.values(result).every(
          value => value === PermissionsAndroid.RESULTS.GRANTED,
        );
      }

      const result = await PermissionsAndroid.request(
        PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
      );

      return result === PermissionsAndroid.RESULTS.GRANTED;
    } catch (error) {
      console.log('Permission error:', error);
      return false;
    }
  };

  const stopScan = () => {
    try {
      bleManager.stopDeviceScan();
    } catch (error) {
      console.log('Stop scan error:', error);
    }

    if (scanTimeoutRef.current) {
      clearTimeout(scanTimeoutRef.current);
      scanTimeoutRef.current = null;
    }

    setIsScanning(false);
  };

  const addDeviceToList = (device: Device) => {
    setDevices(previousDevices => {
      const isExisting = previousDevices.some(item => item.id === device.id);
      return isExisting ? previousDevices : [...previousDevices, device];
    });
  };

  const scanDevices = async () => {
    const hasPermission = await requestBluetoothPermissions();

    if (!hasPermission) {
      const message = 'Bạn cần cấp quyền Bluetooth/Vị trí để quét ESP32 BLE.';
      setWarningMessage(message);
      Alert.alert('Thiếu quyền Bluetooth', message);
      return;
    }

    stopScan();

    setDevices([]);
    setWarningMessage(null);
    setIsScanning(true);
    setConnectionStatus('Đang quét thiết bị ESP32 BLE...');

    /*
      Giữ nguyên logic quét theo SERVICE_UUID như code hiện tại của bạn.
      Nếu muốn debug quét tất cả BLE, đổi [SERVICE_UUID] thành null.
    */
    bleManager.startDeviceScan(
      [SERVICE_UUID],
      {allowDuplicates: false},
      (error, device) => {
        if (error) {
          console.log('Scan error:', error);
          setConnectionStatus('Lỗi quét BLE');
          setWarningMessage('Không thể quét BLE. Hãy kiểm tra Bluetooth, quyền ứng dụng và ESP32.');
          setIsScanning(false);
          return;
        }

        if (!device) {
          return;
        }

        const deviceName = device.name || device.localName || '';

        if (
          deviceName === '' ||
          deviceName.toUpperCase().includes(DEVICE_NAME_FILTER.toUpperCase())
        ) {
          addDeviceToList(device);
        }
      },
    );

    scanTimeoutRef.current = setTimeout(() => {
      stopScan();

      setConnectionStatus(previous =>
        previous === 'Đang quét thiết bị ESP32 BLE...'
          ? 'Đã dừng quét'
          : previous,
      );

      setDevices(previousDevices => {
        if (previousDevices.length === 0) {
          setWarningMessage(
            'Không tìm thấy ESP32. Hãy kiểm tra ESP32 đã bật BLE advertising, đúng UUID và đang cấp nguồn ổn định.',
          );
        }

        return previousDevices;
      });
    }, 10000);
  };

  const parseIncomingJson = (jsonString: string) => {
    setLastRawData(jsonString);

    try {
      const json = JSON.parse(jsonString);

      if (json.status === 'error') {
        const message = json.message || 'sensor_error';
        setConnectionStatus(`Lỗi cảm biến: ${message}`);
        setWarningMessage(`Cảm biến báo lỗi: ${message}`);
        setLastUpdate(new Date().toLocaleTimeString('vi-VN'));
        return;
      }

      setSoilData(previous => normalizeSensorData(json, previous));
      setWarningMessage(null);
      setConnectionStatus('Đã kết nối');
      setLastUpdate(new Date().toLocaleTimeString('vi-VN'));
    } catch (error) {
      console.log('JSON parse error:', error);
      setConnectionStatus('Lỗi parse JSON');
      setWarningMessage('Dữ liệu nhận được không đúng định dạng JSON.');
    }
  };

  const handleIncomingData = (rawData: string) => {
    const text = rawData.trim();

    if (!text) {
      return;
    }

    if (text.startsWith('{') && text.endsWith('}')) {
      receiveBuffer.current = '';
      parseIncomingJson(text);
      return;
    }

    if (text.startsWith('{')) {
      receiveBuffer.current = text;
      return;
    }

    if (receiveBuffer.current) {
      receiveBuffer.current += text;

      if (receiveBuffer.current.endsWith('}')) {
        const fullJson = receiveBuffer.current;
        receiveBuffer.current = '';
        parseIncomingJson(fullJson);
      }
    }
  };

  const startNotification = async (device: Device) => {
    monitorSubscription.current?.remove();

    monitorSubscription.current = device.monitorCharacteristicForService(
      SERVICE_UUID,
      CHARACTERISTIC_UUID,
      (error, characteristic) => {
        if (error) {
          console.log('Notify error:', error);
          setConnectionStatus('Lỗi nhận dữ liệu');
          setWarningMessage('Mất kênh nhận dữ liệu từ ESP32. Hãy ngắt kết nối và kết nối lại.');
          return;
        }

        if (!characteristic?.value) {
          return;
        }

        const rawData = decodeBase64(characteristic.value);
        handleIncomingData(rawData);
      },
    );
  };

  const connectToDevice = async (device: Device) => {
    try {
      stopScan();
      setIsConnecting(true);
      setWarningMessage(null);
      setConnectionStatus('Đang kết nối...');

      const connected = await bleManager.connectToDevice(device.id, {
        autoConnect: false,
      });

      setConnectedDevice(connected);
      setConnectionStatus('Đang tìm service...');

      await connected.discoverAllServicesAndCharacteristics();

      if (Platform.OS === 'android') {
        try {
          await connected.requestMTU(185);
        } catch (error) {
          console.log('MTU request error:', error);
        }
      }

      await startNotification(connected);

      setWarningMessage(null);
      setConnectionStatus('Đã kết nối');
    } catch (error: any) {
      console.log('Connect error:', error);
      setConnectionStatus('Kết nối thất bại');
      setWarningMessage('Kết nối ESP32 thất bại. Hãy reset ESP32 rồi thử lại.');
      Alert.alert('Lỗi kết nối', String(error?.message || error));
    } finally {
      setIsConnecting(false);
    }
  };

  const disconnectDevice = async () => {
    if (!connectedDevice) {
      return;
    }

    try {
      monitorSubscription.current?.remove();
      await bleManager.cancelDeviceConnection(connectedDevice.id);
    } catch (error) {
      console.log('Disconnect error:', error);
    } finally {
      setConnectedDevice(null);
      setConnectionStatus('Chưa kết nối');
      setWarningMessage('Đã ngắt kết nối với ESP32.');
      setLastRawData('Chưa có dữ liệu');
    }
  };

  const isConnected = connectedDevice !== null;

  const connectionCardStyle = isConnected
    ? styles.connectionCardConnected
    : styles.connectionCardDisconnected;

  const statusDotColor = isConnected ? colors.success : colors.danger;

  const statusBadgeStyle = isConnected
    ? styles.statusBadgeConnected
    : styles.statusBadgeDisconnected;

  const statusTextStyle = isConnected
    ? styles.connectionStatusConnected
    : styles.connectionStatusDisconnected;

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="light-content" backgroundColor={colors.ctuBlue} />

      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <View style={styles.logoContainer}>
            {SCHOOL_LOGO ? (
              <Image source={SCHOOL_LOGO} style={styles.logoImage} />
            ) : (
              <View style={styles.logoPlaceholder}>
                <Text style={styles.logoText}>CTU</Text>
                <Text style={styles.logoSmallText}>SOIL</Text>
              </View>
            )}
          </View>

          <View style={styles.headerTextBox}>
            <Text style={styles.schoolName}>ĐẠI HỌC CẦN THƠ</Text>
            <Text style={styles.appTitle}>IoTLab</Text>
    
          </View>
        </View>

        <View style={[styles.connectionCard, connectionCardStyle]}>
          <View style={styles.connectionTop}>
            <View style={{flex: 1}}>
              <Text style={styles.connectionTitle}>Trạng thái kết nối</Text>

              <View style={[styles.statusBadge, statusBadgeStyle]}>
                <View
                  style={[
                    styles.statusDot,
                    {backgroundColor: statusDotColor},
                  ]}
                />
                <Text style={[styles.connectionStatus, statusTextStyle]}>
                  {connectionStatus}
                </Text>
              </View>
            </View>

            {isConnecting && (
              <ActivityIndicator size="small" color={colors.ctuBlue} />
            )}
          </View>

          <Text style={styles.deviceName}>
            Thiết bị:{' '}
            {connectedDevice?.name ||
              connectedDevice?.localName ||
              'Chưa chọn thiết bị'}
          </Text>

          <Text style={styles.lastUpdate}>Cập nhật cuối: {lastUpdate}</Text>

          {warningMessage && (
            <View style={styles.warningBox}>
              <Text style={styles.warningIcon}>⚠️</Text>
              <Text style={styles.warningText}>{warningMessage}</Text>
            </View>
          )}

          <View style={styles.buttonRow}>
            <TouchableOpacity
              style={[
                styles.primaryButton,
                isScanning && styles.disabledButton,
              ]}
              onPress={scanDevices}
              disabled={isScanning || isConnecting}>
              <Text style={styles.primaryButtonText}>
                {isScanning ? 'Đang quét...' : 'Quét ESP32'}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[
                styles.secondaryButton,
                !isConnected && styles.disabledButton,
              ]}
              onPress={disconnectDevice}
              disabled={!isConnected}>
              <Text style={styles.secondaryButtonText}>Ngắt kết nối</Text>
            </TouchableOpacity>
          </View>
        </View>

        {devices.length > 0 && !isConnected && (
          <View style={styles.deviceListCard}>
            <Text style={styles.sectionTitle}>Thiết bị tìm thấy</Text>

            {devices.map(device => (
              <TouchableOpacity
                key={device.id}
                style={styles.deviceItem}
                onPress={() => connectToDevice(device)}
                disabled={isConnecting}>
                <View style={styles.deviceItemInfo}>
                  <Text style={styles.deviceItemName}>
                    {device.name || device.localName || 'ESP32 BLE Device'}
                  </Text>
                  <Text style={styles.deviceItemId}>{device.id}</Text>
                </View>

                <Text style={styles.connectText}>Kết nối</Text>
              </TouchableOpacity>
            ))}
          </View>
        )}

        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Thông số cảm biến</Text>
          <Text style={styles.sectionSubtitle}>Dữ liệu nhận từ ESP32 BLE</Text>
        </View>

        <View style={styles.metricGrid}>
          <MetricCard
            title="Pin thiết bị"
            value={soilData.battery}
            unit="%"
            icon="🔋"
           
            digits={0}
            progress={soilData.battery}
          />

          <MetricCard
            title="Nhiệt độ"
            value={soilData.temperature}
            unit="°C"
            icon="🌡️"
         
            digits={1}
          />

          <MetricCard
            title="Độ ẩm đất"
            value={soilData.humidity}
            unit="%"
            icon="💧"
         
            digits={1}
            progress={soilData.humidity}
          />

          <MetricCard
            title="Độ pH"
            value={soilData.ph}
            unit="pH"
            icon="🧪"
            
            digits={2}
            progress={
              soilData.ph === null
                ? null
                : Math.max(0, Math.min(100, soilData.ph * 7.14))
            }
          />

          <MetricCard
            title="Nito"
            value={soilData.nitrogen}
            unit="mg/kg"
            icon="N"
            
            digits={0}
          />

          <MetricCard
            title="Photpho"
            value={soilData.phosphorus}
            unit="mg/kg"
            icon="P"
            
            digits={0}
          />

          <MetricCard
            title="Kali"
            value={soilData.potassium}
            unit="mg/kg"
            icon="K"
            
            digits={0}
          />

          <MetricCard
            title="Độ dẫn điện"
            value={soilData.ec}
            unit="µS/cm"
            icon="⚡"
           
            digits={0}
          />

          
        </View>

        <View style={styles.rawDataCard}>
          <Text style={styles.rawDataTitle}>Dữ liệu JSON nhận được</Text>
          <Text style={styles.rawDataText}>{lastRawData}</Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const colors = {
  ctuBlue: '#005BAC',
  ctuBlueDark: '#004A8F',
  ctuBlueLight: '#EAF4FF',
  ctuBlueSoft: '#F5FAFF',
  white: '#FFFFFF',
  textDark: '#073B6D',
  textMuted: '#5B7088',
  border: '#D6E9FA',
  success: '#16A34A',
  successLight: '#DCFCE7',
  danger: '#EF4444',
  dangerLight: '#FEF2F2',
  warning: '#F59E0B',
  warningLight: '#FFFBEB',
};

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.ctuBlue,
  },

  container: {
    flex: 1,
    backgroundColor: colors.white,
  },

  content: {
    paddingBottom: 28,
  },

  header: {
    backgroundColor: colors.ctuBlue,
    paddingHorizontal: 18,
    paddingTop: 18,
    paddingBottom: 28,
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomLeftRadius: 34,
    borderBottomRightRadius: 34,
  },

  logoContainer: {
    width: 84,
    height: 84,
    borderRadius: 26,
    backgroundColor: colors.white,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 8,
    marginRight: 14,
  },

  logoImage: {
    width: '100%',
    height: '100%',
    resizeMode: 'contain',
  },

  logoPlaceholder: {
    width: '100%',
    height: '100%',
    borderRadius: 20,
    borderWidth: 2,
    borderColor: colors.ctuBlue,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.ctuBlueLight,
  },

  logoText: {
    fontSize: 20,
    fontWeight: '900',
    color: colors.ctuBlue,
  },

  logoSmallText: {
    fontSize: 11,
    fontWeight: '800',
    color: colors.ctuBlueDark,
    marginTop: 2,
  },

  headerTextBox: {
    flex: 1,
  },

  schoolName: {
    fontSize: 20,
    fontWeight: '900',
    color: colors.white,
    letterSpacing: 0.8,
  },

  appTitle: {
    fontSize: 18,
    fontWeight: '900',
    color: colors.white,
    marginTop: 4,
  },

  appSubtitle: {
    fontSize: 13,
    color: colors.ctuBlueLight,
    marginTop: 4,
  },

  connectionCard: {
    marginHorizontal: 16,
    marginTop: -16,
    backgroundColor: colors.white,
    borderRadius: 26,
    padding: 16,
    borderWidth: 1,
    shadowColor: '#073B6D',
    shadowOffset: {width: 0, height: 6},
    shadowOpacity: 0.12,
    shadowRadius: 12,
    elevation: 5,
  },

  connectionCardConnected: {
    borderColor: colors.success,
    backgroundColor: '#F8FFFB',
  },

  connectionCardDisconnected: {
    borderColor: colors.border,
    backgroundColor: colors.white,
  },

  connectionTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },

  connectionTitle: {
    fontSize: 15,
    fontWeight: '900',
    color: colors.textDark,
    marginBottom: 8,
  },

  statusBadge: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderWidth: 1,
  },

  statusBadgeConnected: {
    backgroundColor: colors.successLight,
    borderColor: colors.success,
  },

  statusBadgeDisconnected: {
    backgroundColor: colors.dangerLight,
    borderColor: colors.danger,
  },

  statusLine: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 7,
  },

  statusDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginRight: 8,
  },

  connectionStatus: {
    fontSize: 14,
    fontWeight: '900',
  },

  connectionStatusConnected: {
    color: colors.success,
  },

  connectionStatusDisconnected: {
    color: colors.danger,
  },

  deviceName: {
    marginTop: 12,
    fontSize: 13,
    color: colors.textMuted,
  },

  lastUpdate: {
    marginTop: 4,
    fontSize: 13,
    color: colors.textMuted,
  },

  warningBox: {
    marginTop: 12,
    backgroundColor: colors.warningLight,
    borderColor: colors.warning,
    borderWidth: 1,
    borderRadius: 16,
    padding: 12,
    flexDirection: 'row',
    alignItems: 'flex-start',
  },

  warningIcon: {
    fontSize: 16,
    marginRight: 8,
  },

  warningText: {
    flex: 1,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '700',
    color: '#92400E',
  },

  buttonRow: {
    flexDirection: 'row',
    marginTop: 16,
  },

  primaryButton: {
    flex: 1,
    height: 46,
    borderRadius: 15,
    backgroundColor: colors.ctuBlue,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 5,
  },

  secondaryButton: {
    flex: 1,
    height: 46,
    borderRadius: 15,
    backgroundColor: colors.ctuBlueLight,
    borderWidth: 1,
    borderColor: colors.border,
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: 5,
  },

  disabledButton: {
    opacity: 0.55,
  },

  primaryButtonText: {
    color: colors.white,
    fontSize: 14,
    fontWeight: '900',
  },

  secondaryButtonText: {
    color: colors.ctuBlue,
    fontSize: 14,
    fontWeight: '900',
  },

  deviceListCard: {
    marginHorizontal: 16,
    marginTop: 16,
    backgroundColor: colors.white,
    borderRadius: 24,
    padding: 16,
    borderWidth: 1,
    borderColor: colors.border,
  },

  deviceItem: {
    marginTop: 10,
    borderRadius: 17,
    padding: 14,
    backgroundColor: colors.ctuBlueSoft,
    borderWidth: 1,
    borderColor: colors.border,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },

  deviceItemInfo: {
    flex: 1,
    paddingRight: 10,
  },

  deviceItemName: {
    fontSize: 15,
    fontWeight: '900',
    color: colors.textDark,
  },

  deviceItemId: {
    fontSize: 11,
    color: colors.textMuted,
    marginTop: 4,
  },

  connectText: {
    fontSize: 13,
    fontWeight: '900',
    color: colors.ctuBlue,
  },

  sectionHeader: {
    marginHorizontal: 16,
    marginTop: 22,
    marginBottom: 6,
  },

  sectionTitle: {
    fontSize: 18,
    fontWeight: '900',
    color: colors.textDark,
  },

  sectionSubtitle: {
    fontSize: 13,
    color: colors.textMuted,
    marginTop: 3,
  },

  metricGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: 10,
  },

  metricCardWrapper: {
    width: '50%',
    padding: 6,
  },

  metricCard: {
    backgroundColor: colors.white,
    borderRadius: 23,
    padding: 14,
    minHeight: 150,
    borderWidth: 1,
    borderColor: colors.border,
    shadowColor: '#073B6D',
    shadowOffset: {width: 0, height: 3},
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 2,
  },

  metricTop: {
    flexDirection: 'row',
    alignItems: 'center',
  },

  iconBox: {
    width: 40,
    height: 40,
    borderRadius: 14,
    backgroundColor: colors.ctuBlueLight,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 10,
  },

  iconText: {
    fontSize: 20,
    fontWeight: '900',
    color: colors.ctuBlue,
  },

  metricInfo: {
    flex: 1,
  },

  metricTitle: {
    fontSize: 15 ,
    fontWeight: '900',
    color: colors.textDark,
  },

  metricNote: {
    fontSize: 10.5,
    color: colors.textMuted,
    marginTop: 2,
  },

  metricValueRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    marginTop: 18,
  },

  metricValue: {
    fontSize: 25,
    fontWeight: '900',
    color: colors.ctuBlue,
  },

  metricUnit: {
    fontSize: 20,
    fontWeight: '800',
    color: colors.textMuted,
    marginLeft: 5,
    marginBottom: 4,
  },

  progressBackground: {
    height: 7,
    backgroundColor: colors.ctuBlueLight,
    borderRadius: 10,
    overflow: 'hidden',
    marginTop: 14,
  },

  progressFill: {
    height: '100%',
    backgroundColor: colors.ctuBlue,
    borderRadius: 10,
  },

  rawDataCard: {
    marginHorizontal: 16,
    marginTop: 18,
    backgroundColor: colors.ctuBlueDark,
    borderRadius: 24,
    padding: 16,
  },

  rawDataTitle: {
    fontSize: 14,
    fontWeight: '900',
    color: colors.white,
  },

  rawDataText: {
    marginTop: 8,
    fontSize: 12,
    lineHeight: 18,
    color: colors.ctuBlueLight,
  },
});