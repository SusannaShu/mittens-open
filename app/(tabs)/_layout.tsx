import { useState, useEffect } from 'react';
import { Image } from 'react-native';
import { Tabs } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { Feather } from '@expo/vector-icons';
import { colors, fonts } from '../../lib/theme';
import { getUnreadCount, onUnreadChange, clearUnread } from '../../lib/mittensNotify';
import { usePathname } from 'expo-router';

const MITTENS_ICON = require('../../assets/icon.png');

export default function Layout() {
  const [unread, setUnread] = useState(getUnreadCount());
  const pathname = usePathname();

  useEffect(() => {
    return onUnreadChange((count) => {
      if (pathname === '/chat' && count > 0) {
        clearUnread();
      } else {
        setUnread(count);
      }
    });
  }, [pathname]);

  // Clear unread when user navigates to chat tab
  useEffect(() => {
    if (pathname === '/chat') {
      clearUnread();
    }
  }, [pathname]);

  return (
    <>
      <StatusBar style="dark" />
      <Tabs
        screenOptions={{
          headerStyle: { backgroundColor: colors.bg },
          headerTintColor: colors.textPrimary,
          headerTitleStyle: { fontFamily: fonts.heading, fontSize: 17 },
          tabBarStyle: {
            backgroundColor: colors.bg,
            borderTopColor: colors.border,
            borderTopWidth: 1,
            paddingTop: 8,
            paddingBottom: 8,
            height: 88,
          },
          tabBarActiveTintColor: '#000',
          tabBarInactiveTintColor: '#BFBFBF',
          tabBarLabelStyle: { fontSize: 11, fontWeight: '500', marginTop: 4 },
        }}
      >
        <Tabs.Screen
          name="index"
          options={{
            title: 'Today',
            headerShown: false,
            tabBarIcon: ({ color }) => <Feather name="sun" size={20} color={color} />,
          }}
        />
        <Tabs.Screen
          name="chat"
          options={{
            title: 'Mittens',
            headerTitle: 'Mittens',
            headerLeft: () => (
              <Image source={MITTENS_ICON} style={{ width: 28, height: 28, borderRadius: 14, marginLeft: 16 }} />
            ),
            tabBarIcon: ({ color }) => <Feather name="message-circle" size={20} color={color} />,
            tabBarBadge: unread > 0 ? unread : undefined,
            tabBarBadgeStyle: {
              backgroundColor: '#000',
              color: '#fff',
              fontSize: 10,
              minWidth: 18,
              height: 18,
              borderRadius: 9,
            },
          }}
        />
        <Tabs.Screen
          name="sync"
          options={{
            title: 'Reflect',
            headerTitle: 'Reflect',
            tabBarIcon: ({ color }) => <Feather name="calendar" size={20} color={color} />,
          }}
        />
        <Tabs.Screen
          name="places"
          options={{
            title: 'Places',
            headerTitle: 'Places',
            tabBarIcon: ({ color }) => <Feather name="map" size={20} color={color} />,
          }}
        />
        <Tabs.Screen
          name="schedule"
          options={{
            title: 'Profile',
            headerTitle: 'Profile',
            tabBarIcon: ({ color }) => <Feather name="user" size={20} color={color} />,
          }}
        />
      </Tabs>
    </>
  );
}
