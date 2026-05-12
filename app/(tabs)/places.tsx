import React, { useState } from 'react';
import { View, StyleSheet, Dimensions, Text, SafeAreaView, TouchableOpacity, ActivityIndicator, Alert } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import * as Location from 'expo-location';
import MapView, { Marker, Polyline, Callout } from 'react-native-maps';
import { Feather } from '@expo/vector-icons';
import { colors, radius, spacing } from '../../lib/theme';
import { useGetLocationSessionsQuery } from '../../lib/services/location/locationSessionApi';
import { useGetKnownPlacesQuery, useDeleteKnownPlaceMutation } from '../../lib/services/location/knownPlaceApi';
import PlaceDraftOverlay from '../../components/places/PlaceDraftOverlay';
import KnownPlacesListModal from '../../components/places/KnownPlacesListModal';
import PlaceDetailsModal from '../../components/places/PlaceDetailsModal';
import LocationLogModal from '../../components/places/LocationLogModal';
import { LocationSession } from '../../lib/services/location/locationSessionApi';
import { KnownPlace } from '../../lib/services/location/knownPlaceApi';
import ActivityEditModal from '../../components/common/ActivityEditModal';
import { useLogActivityMutation, useGetDailyActivitiesQuery, ActivityEntry } from '../../lib/services/activityApi';
import { getCurrentLocation } from '../../lib/services/location/locationService';

const MOTION_COLORS: Record<string, string> = {
  stationary: '#9E9E9E', walking: '#9E9E9E', cycling: '#9E9E9E',
  driving: '#9E9E9E', unknown: '#BDBDBD',
};

export default function PlacesScreen() {
  const params = useLocalSearchParams<{ editPlaceName?: string; editPlaceType?: string }>();
  const [selectedDate, setSelectedDate] = useState(new Date().toLocaleDateString('en-CA'));
  const { data: sessions = [], isLoading } = useGetLocationSessionsQuery(selectedDate, {
    pollingInterval: 60000, // Poll every 60s for live trail tracking
  });
  const { data: places = [], refetch: refetchPlaces } = useGetKnownPlacesQuery();
  const [deletePlace] = useDeleteKnownPlaceMutation();

  const [draftLocation, setDraftLocation] = useState<{latitude: number; longitude: number} | null>(null);

  const formatTime = (dateStr: string | null) => {
    if (!dateStr) return 'now';
    return new Date(dateStr).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }).toLowerCase();
  };

  const [isDraftMode, setIsDraftMode] = useState(false);
  const [currentRegion, setCurrentRegion] = useState<any>(null);
  
  const [isListModalVisible, setListModalVisible] = useState(false);
  const [selectedPlace, setSelectedPlace] = useState<KnownPlace | null>(null);
  const [selectedSession, setSelectedSession] = useState<LocationSession | null>(null);
  
  // Activity modal state
  const [editingActivity, setEditingActivity] = useState<ActivityEntry | null>(null);
  const [activityEditVisible, setActivityEditVisible] = useState(false);
  const [logActivity] = useLogActivityMutation();
  const { data: activityData } = useGetDailyActivitiesQuery(selectedDate);
  const dailyActivities = activityData?.activities || [];

  const mapRef = React.useRef<MapView>(null);

  // Update states if params change
  React.useEffect(() => {
    if (params.editPlaceName || params.editPlaceType) {
      handleAddPlaceDraft();
    }
  }, [params.editPlaceName, params.editPlaceType]);

  const handleAddPlaceDraft = () => {
    setIsDraftMode(true);
    setDraftLocation(null);
  };

  const handleZoom = (direction: 'in' | 'out') => {
    if (!currentRegion) return;
    const multiplier = direction === 'in' ? 0.5 : 2;
    mapRef.current?.animateToRegion({
      ...currentRegion,
      latitudeDelta: Math.max(0.001, currentRegion.latitudeDelta * multiplier),
      longitudeDelta: Math.max(0.001, currentRegion.longitudeDelta * multiplier),
    }, 300);
  };

  const getSessionColor = (startedAt: string, motionType: string) => {
    return MOTION_COLORS[motionType] || MOTION_COLORS.unknown;
  };

  const getRegion = () => {
    const liveLoc = getCurrentLocation();
    if (liveLoc && liveLoc.lat && liveLoc.lon) {
      return {
        latitude: liveLoc.lat,
        longitude: liveLoc.lon,
        latitudeDelta: 0.02,
        longitudeDelta: 0.02,
      };
    }
    const ongoingSession = sessions.find(s => s.motionType === 'stationary' && s.path && s.path.length > 0 && !s.endedAt);
    if (ongoingSession) {
      return {
        latitude: ongoingSession.path[0][0],
        longitude: ongoingSession.path[0][1],
        latitudeDelta: 0.05,
        longitudeDelta: 0.05,
      };
    }
    if (places.length > 0) {
      const home = places.find(p => p.placeType === 'home') || places[0];
      return {
        latitude: home.latitude,
        longitude: home.longitude,
        latitudeDelta: 0.05,
        longitudeDelta: 0.05,
      };
    }
    return {
      latitude: 40.7128,
      longitude: -74.006,
      latitudeDelta: 0.1,
      longitudeDelta: 0.1,
    };
  };

  return (
    <SafeAreaView style={styles.container}>
      {isLoading ? (
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
          <ActivityIndicator size="large" color="#000" />
        </View>
      ) : (
        <MapView
          ref={mapRef}
          style={StyleSheet.absoluteFillObject}
          initialRegion={getRegion()}
          onRegionChangeComplete={setCurrentRegion}
          showsUserLocation={true}
          showsMyLocationButton={false}
          mapPadding={{ 
            top: isDraftMode ? 140 : 60, 
            bottom: draftLocation ? 420 : 0, 
            left: 0, right: 0 
          }}
          onPress={(e) => {
            if (isDraftMode) {
              const coord = e.nativeEvent.coordinate;
              setDraftLocation(coord);
              setTimeout(() => {
                mapRef.current?.animateToRegion({ ...coord, latitudeDelta: 0.005, longitudeDelta: 0.005 });
              }, 100);
            }
          }}
        >
          {sessions.map((session, idx) => {
            const hasPath = session.path && session.path.length >= 2;
            const isStationary = session.motionType === 'stationary';
            const color = getSessionColor(session.startedAt, session.motionType);
            
            if (isStationary && session.path && session.path.length > 0) {
              const placeLabel = session.placeName && !/^[\d\.-]+,\s*[\d\.-]+$/.test(session.placeName) ? session.placeName + ' • ' : '';
              return (
                <Marker
                  key={`stat-${idx}`}
                  coordinate={{ latitude: session.path[0][0], longitude: session.path[0][1] }}
                  onPress={() => setSelectedSession(session)}
                >
                  <View style={{ alignItems: 'center' }}>
                    <View style={{ width: 14, height: 14, borderRadius: 7, backgroundColor: color, borderWidth: 2, borderColor: '#FFF', shadowColor: '#000', shadowOpacity: 0.3, shadowRadius: 3, shadowOffset: { width: 0, height: 2 } }} />
                    <Text style={{ marginTop: 2, fontSize: 10, fontWeight: '500', color, backgroundColor: 'rgba(255,255,255,0.8)', paddingHorizontal: 4, borderRadius: 4, overflow: 'hidden' }}>
                      {placeLabel}{formatTime(session.startedAt)} - {formatTime(session.endedAt)}
                    </Text>
                  </View>
                </Marker>
              );
            }
            if (hasPath && !isStationary) {
              const midPoint = session.path[Math.floor(session.path.length / 2)];
              // Ensure color defaults to gray if unknown
              const strokeColor = color === '#BDBDBD' || color === '#9E9E9E' ? '#757575' : color;
              return (
                <React.Fragment key={`poly-${idx}`}>
                  <Polyline
                    coordinates={session.path.map((p: any) => ({ latitude: p[0], longitude: p[1] }))}
                    strokeColor={strokeColor}
                    strokeWidth={5}
                    lineCap="round"
                    lineJoin="round"
                    tappable
                    onPress={() => setSelectedSession(session)}
                  />
                  {session.path.map((p: any, pIdx: number) => {
                    const isStart = pIdx === 0;
                    const isEnd = pIdx === session.path.length - 1;
                    if (!isStart && !isEnd) return null; // Hide all intermediate dots for a clean trail
                    const dotColor = isEnd ? '#000000' : isStart ? '#9E9E9E' : strokeColor;
                    const radius = (isStart || isEnd) ? 10 : 8;
                    return (
                      <Marker key={`dot-${idx}-${pIdx}`} coordinate={{ latitude: p[0], longitude: p[1] }} tracksViewChanges={false}>
                        <View style={{ width: radius, height: radius, borderRadius: radius/2, backgroundColor: dotColor, borderWidth: 1, borderColor: '#FFF', zIndex: (isStart || isEnd) ? 10 : 1 }} />
                      </Marker>
                    );
                  })}
                  <Marker coordinate={{ latitude: midPoint[0], longitude: midPoint[1] }} onPress={() => setSelectedSession(session)}>
                    <View style={{ alignItems: 'center' }}>
                      <Text style={{ fontSize: 10, fontWeight: '500', color: strokeColor, backgroundColor: 'rgba(255,255,255,0.8)', paddingHorizontal: 4, borderRadius: 4, overflow: 'hidden' }}>
                        {formatTime(session.startedAt)} - {formatTime(session.endedAt)}
                      </Text>
                    </View>
                  </Marker>
                </React.Fragment>
              );
            }
            return null;
          })}

          {/* Trail connectors: draw lines between consecutive sessions */}
          {sessions.map((session, idx) => {
            if (idx === 0) return null;
            const prev = sessions[idx - 1];
            // Get the last coordinate of the previous session
            const prevEnd = prev.path && prev.path.length > 0
              ? prev.path[prev.path.length - 1]
              : null;
            // Get the first coordinate of the current session
            const currStart = session.path && session.path.length > 0
              ? session.path[0]
              : null;
            if (!prevEnd || !currStart) return null;
            // Skip if same coordinate (already visually connected)
            if (Math.abs(prevEnd[0] - currStart[0]) < 0.00001 &&
                Math.abs(prevEnd[1] - currStart[1]) < 0.00001) return null;
            return (
              <Polyline
                key={`trail-conn-${idx}`}
                coordinates={[
                  { latitude: prevEnd[0], longitude: prevEnd[1] },
                  { latitude: currStart[0], longitude: currStart[1] },
                ]}
                strokeColor="#BDBDBD"
                strokeWidth={3}
                lineDashPattern={[6, 4]}
                lineCap="round"
              />
            );
          })}

          {places.map((p) => {
            const iconName = p.icon || 'map-pin';
            return (
              <Marker
                key={`place-${p.id}`}
                coordinate={{ latitude: p.latitude, longitude: p.longitude }}
                onPress={() => setSelectedPlace(p)}
              >
                <View style={{ alignItems: 'center' }}>
                  <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: '#000', borderWidth: 2, borderColor: '#FFF', shadowColor: '#000', shadowOpacity: 0.3, shadowRadius: 3, shadowOffset: { width: 0, height: 2 }, justifyContent: 'center', alignItems: 'center' }}>
                    <Feather name={iconName as any} size={18} color="#FFF" />
                  </View>
                  <Text style={{ marginTop: 4, fontSize: 12, fontWeight: '600', color: '#000', backgroundColor: 'rgba(255,255,255,0.8)', paddingHorizontal: 4, borderRadius: 4, overflow: 'hidden' }}>
                    {p.name}
                  </Text>
                </View>
              </Marker>
            );
          })}

          {draftLocation && (
            <Marker
              coordinate={draftLocation}
              draggable
              onDragEnd={(e) => setDraftLocation(e.nativeEvent.coordinate)}
            >
              <View style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: '#1E88E5', borderWidth: 3, borderColor: '#FFF', shadowColor: '#000', shadowOpacity: 0.5, shadowRadius: 5, shadowOffset: { width: 0, height: 3 }, justifyContent: 'center', alignItems: 'center' }}>
                <Feather name="map-pin" size={20} color="#FFF" style={{ position: 'absolute', top: -30 }} />
                <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: '#FFF' }} />
              </View>
            </Marker>
          )}
        </MapView>
      )}

      {/* Floating Action Buttons */}
      {!isDraftMode && (
        <View style={styles.fabContainer}>
          <TouchableOpacity 
            style={styles.fab} 
            onPress={async () => {
              try {
                const loc = await Location.getLastKnownPositionAsync({}) || await Location.getCurrentPositionAsync({});
                mapRef.current?.animateToRegion({
                  latitude: loc.coords.latitude,
                  longitude: loc.coords.longitude,
                  latitudeDelta: 0.005,
                  longitudeDelta: 0.005,
                });
              } catch (e) {
                // Ignore
              }
            }}
            activeOpacity={0.8}
          >
            <Feather name="navigation" size={24} color="#FFF" />
          </TouchableOpacity>

          <TouchableOpacity 
            style={styles.fab} 
            onPress={() => setListModalVisible(true)}
            activeOpacity={0.8}
          >
            <Feather name="list" size={24} color="#FFF" />
          </TouchableOpacity>
          
          <TouchableOpacity 
            style={styles.fab} 
            onPress={handleAddPlaceDraft}
            activeOpacity={0.8}
          >
            <Feather name="plus" size={24} color="#FFF" />
          </TouchableOpacity>
        </View>
      )}

      {/* Zoom Controls */}
      <View style={[styles.zoomContainer, isDraftMode && { top: 140 }]}>
        <TouchableOpacity style={styles.zoomBtn} onPress={() => handleZoom('in')} activeOpacity={0.7}>
          <Feather name="plus" size={24} color="#000" />
        </TouchableOpacity>
        <View style={styles.zoomDivider} />
        <TouchableOpacity style={styles.zoomBtn} onPress={() => handleZoom('out')} activeOpacity={0.7}>
          <Feather name="minus" size={24} color="#000" />
        </TouchableOpacity>
      </View>

      <PlaceDraftOverlay
        visible={isDraftMode}
        coordinate={draftLocation}
        onCancel={() => {
          setDraftLocation(null);
          setIsDraftMode(false);
        }}
        onSuccess={() => {
          setDraftLocation(null);
          setIsDraftMode(false);
          refetchPlaces();
        }}
        onSearchSelect={(coord) => {
          setDraftLocation(coord);
          mapRef.current?.animateToRegion({ ...coord, latitudeDelta: 0.005, longitudeDelta: 0.005 });
        }}
        initialName={params.editPlaceName || ''}
        initialType={params.editPlaceType || 'other'}
      />
      
      <KnownPlacesListModal
        visible={isListModalVisible}
        onClose={() => setListModalVisible(false)}
        onSelectPlace={(p) => {
          mapRef.current?.animateToRegion({
            latitude: p.latitude,
            longitude: p.longitude,
            latitudeDelta: 0.005,
            longitudeDelta: 0.005,
          });
          setSelectedPlace(p);
        }}
      />
      
      <PlaceDetailsModal
        visible={!!selectedPlace}
        place={selectedPlace}
        onClose={() => setSelectedPlace(null)}
        onSuccess={() => refetchPlaces()}
      />
      
      <LocationLogModal
        visible={!!selectedSession}
        session={selectedSession}
        onClose={() => setSelectedSession(null)}
        existingActivity={
          selectedSession 
            ? dailyActivities.find(a => 
                Math.abs(new Date(a.loggedAt).getTime() - new Date(selectedSession.startedAt).getTime()) < 5 * 60000
              )
            : undefined
        }
        onViewActivity={(act) => {
          setEditingActivity(act as ActivityEntry);
          setActivityEditVisible(true);
        }}
        onConvertActivity={(draft) => {
          setEditingActivity(draft as ActivityEntry);
          setActivityEditVisible(true);
        }}
      />
      
      <ActivityEditModal
        visible={activityEditVisible}
        activity={editingActivity}
        onClose={() => { setActivityEditVisible(false); setEditingActivity(null); }}
        onSave={async (id, data) => {
          await logActivity({ ...data, source: 'location' } as any).unwrap();
        }}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
  },
  fabContainer: {
    position: 'absolute',
    bottom: spacing.xl,
    right: spacing.lg,
    flexDirection: 'column',
    gap: 16,
  },
  fab: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#000',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 5,
    elevation: 6,
  },
  zoomContainer: {
    position: 'absolute',
    left: spacing.lg,
    top: spacing.lg,
    backgroundColor: '#FFF',
    borderRadius: 12,
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 5,
  },
  zoomBtn: {
    width: 44,
    height: 44,
    justifyContent: 'center',
    alignItems: 'center',
  },
  zoomDivider: {
    height: 1,
    backgroundColor: colors.border,
    marginHorizontal: 8,
  }
});
