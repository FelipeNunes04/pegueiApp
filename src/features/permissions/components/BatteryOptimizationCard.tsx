import React from 'react';
import { Text, View } from 'react-native';
import { useBatteryOptimization } from '../hooks/useBatteryOptimization';
import { PermissionActionButton } from './PermissionActionButton';
import { styles } from './BatteryOptimizationCard.styles';

const STATUS_LABEL = {
  unknown: 'Verificando...',
  restricted: 'Otimizada: o Android pode pausar o Peguei em segundo plano',
  unrestricted: 'Sem restrição',
} as const;

/**
 * Non-blocking recommendation (never gates navigation): asks the user to
 * exempt Peguei from Android battery optimization so Doze doesn't pause the
 * buffer while the screen is off. Opens the system list rather than the
 * direct REQUEST_IGNORE_BATTERY_OPTIMIZATIONS dialog -- Play policy only
 * allows that for a narrow set of app categories. Renders nothing off
 * Android. Shared by PermissionsScreen and SettingsScreen.
 */
export function BatteryOptimizationCard() {
  const { status, isAndroid, openSettings } = useBatteryOptimization();

  if (!isAndroid) {
    return null;
  }

  return (
    <View style={styles.card} testID="battery-optimization-card">
      <Text style={styles.title}>Bateria (opcional)</Text>
      <Text style={styles.description}>
        Para o buffer não ser pausado com a tela desligada, deixe o Peguei sem
        restrição de bateria nas configurações do Android.
      </Text>
      <Text
        style={[styles.status, status === 'restricted' && styles.statusWarning]}
        testID="battery-optimization-status"
      >
        {STATUS_LABEL[status]}
      </Text>
      <PermissionActionButton
        testID="battery-optimization-action"
        label="Abrir configurações"
        disabledLabel="Tudo certo"
        onPress={openSettings}
        disabled={status === 'unrestricted'}
      />
    </View>
  );
}
