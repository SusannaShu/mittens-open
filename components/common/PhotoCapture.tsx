/**
 * PhotoCapture -- Camera/gallery picker for chat input.
 * Supports multiple photos: multi-select from gallery, multiple captures from camera.
 * Returns array of base64 images to parent via onCapture callback.
 */

import { useState, useRef } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Modal,
  Alert, Image, ScrollView,
} from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as ImagePicker from 'expo-image-picker';
import { colors, radius, spacing } from '../../lib/theme';
import { Feather } from '@expo/vector-icons';

interface PhotoCaptureProps {
  onCapture: (photos: string[], timestamps?: Date[]) => void;
}

export default function PhotoCapture({ onCapture }: PhotoCaptureProps) {
  const [permission, requestPermission] = useCameraPermissions();
  const [showCamera, setShowCamera] = useState(false);
  const [captured, setCaptured] = useState<string[]>([]); // multi-capture buffer
  const [preview, setPreview] = useState<string | null>(null); // latest snap for confirm/retake
  const cameraRef = useRef<CameraView>(null);

  const pickFromGallery = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.7,
      allowsMultipleSelection: true,
      selectionLimit: 10,
      exif: true,
    });
    if (!result.canceled && result.assets.length > 0) {
      // Return file URIs for fast preview rendering (not base64)
      const photos = result.assets
        .filter(a => a.uri)
        .map(a => a.uri);

      // Extract EXIF timestamp from EACH photo individually
      const timestamps: (Date | undefined)[] = result.assets.map(asset => {
        if (asset.exif?.DateTimeOriginal) {
          const exifStr = asset.exif.DateTimeOriginal;
          const parsed = new Date(exifStr.replace(/^(\d{4}):(\d{2}):(\d{2})/, '$1-$2-$3'));
          if (!isNaN(parsed.getTime())) return parsed;
        }
        return undefined;
      });

      if (photos.length > 0) {
        const validTimestamps = timestamps.filter((t): t is Date => t !== undefined);
        onCapture(photos, validTimestamps.length > 0 ? validTimestamps : undefined);
      }
    }
  };

  const openCamera = async () => {
    if (!permission?.granted) {
      const result = await requestPermission();
      if (!result.granted) {
        Alert.alert('Camera Access', 'Camera permission is needed to snap photos.');
        return;
      }
    }
    setCaptured([]);
    setPreview(null);
    setShowCamera(true);
  };

  const takePhoto = async () => {
    if (!cameraRef.current) return;
    try {
      const result = await cameraRef.current.takePictureAsync({
        quality: 0.7,
      });
      if (result?.uri) {
        setPreview(result.uri);
      }
    } catch {
      Alert.alert('Error', 'Failed to take photo');
    }
  };

  /** Add current preview to captured batch, go back to camera for more */
  const addAnother = () => {
    if (preview) {
      setCaptured(prev => [...prev, preview]);
      setPreview(null);
    }
  };

  /** Confirm all photos and send to chat */
  const confirmPhotos = () => {
    const all = preview ? [...captured, preview] : captured;
    if (all.length > 0) {
      onCapture(all);
    }
    setCaptured([]);
    setPreview(null);
    setShowCamera(false);
  };

  const retakePhoto = () => {
    setPreview(null);
  };

  const closeCamera = () => {
    // If user already captured some photos, ask if they want to keep them
    if (captured.length > 0) {
      Alert.alert(
        'Discard photos?',
        `You have ${captured.length} photo${captured.length > 1 ? 's' : ''} captured.`,
        [
          { text: 'Keep & Send', onPress: confirmPhotos },
          { text: 'Discard', style: 'destructive', onPress: () => {
            setCaptured([]);
            setPreview(null);
            setShowCamera(false);
          }},
          { text: 'Cancel', style: 'cancel' },
        ]
      );
    } else {
      setCaptured([]);
      setPreview(null);
      setShowCamera(false);
    }
  };

  const totalCount = captured.length + (preview ? 1 : 0);

  return (
    <>
      {/* Inline buttons for chat input bar */}
      <View style={styles.inlineButtons}>
        <TouchableOpacity style={styles.iconBtn} onPress={openCamera}>
          <Feather name="camera" size={20} color={colors.textSecondary} />
        </TouchableOpacity>
        <TouchableOpacity style={styles.iconBtn} onPress={pickFromGallery}>
          <Feather name="image" size={20} color={colors.textSecondary} />
        </TouchableOpacity>
      </View>

      {/* Full-screen camera modal */}
      <Modal visible={showCamera} animationType="slide" presentationStyle="fullScreen">
        <View style={styles.cameraContainer}>
          {preview ? (
            // Photo preview with add-more option
            <>
              <Image
                source={{ uri: preview }}
                style={styles.cameraFull}
                resizeMode="cover"
              />

              {/* Thumbnail strip of already-captured photos */}
              {captured.length > 0 && (
                <View style={styles.thumbStrip}>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                    {captured.map((img, i) => (
                      <Image
                        key={i}
                        source={{ uri: `data:image/jpeg;base64,${img}` }}
                        style={styles.thumbImg}
                        resizeMode="cover"
                      />
                    ))}
                  </ScrollView>
                </View>
              )}

              <View style={styles.previewActions}>
                <TouchableOpacity style={styles.previewBtn} onPress={retakePhoto}>
                  <Feather name="rotate-ccw" size={18} color="#FFF" />
                  <Text style={styles.previewBtnText}>Retake</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.previewBtn} onPress={addAnother}>
                  <Feather name="plus" size={18} color="#FFF" />
                  <Text style={styles.previewBtnText}>Add More</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.confirmBtn} onPress={confirmPhotos}>
                  <Feather name="check" size={18} color="#FFF" />
                  <Text style={styles.confirmBtnText}>
                    Send{totalCount > 1 ? ` (${totalCount})` : ''}
                  </Text>
                </TouchableOpacity>
              </View>
            </>
          ) : (
            // Camera viewfinder
            <>
              <CameraView ref={cameraRef} style={styles.cameraFull} facing="back">
                <View style={styles.viewfinderOverlay}>
                  <View style={styles.viewfinder} />
                  <Text style={styles.hint}>
                    {captured.length > 0
                      ? `${captured.length} photo${captured.length > 1 ? 's' : ''} taken -- snap more or send`
                      : 'Snap your meal, fridge, or anything'}
                  </Text>
                </View>
              </CameraView>

              {/* Thumbnail strip of already-captured photos */}
              {captured.length > 0 && (
                <View style={styles.thumbStripCamera}>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                    {captured.map((img, i) => (
                      <Image
                        key={i}
                        source={{ uri: `data:image/jpeg;base64,${img}` }}
                        style={styles.thumbImg}
                        resizeMode="cover"
                      />
                    ))}
                  </ScrollView>
                </View>
              )}

              <View style={styles.cameraControls}>
                <TouchableOpacity style={styles.closeBtn} onPress={closeCamera}>
                  <Feather name="x" size={24} color="#FFF" />
                </TouchableOpacity>
                <TouchableOpacity style={styles.captureBtn} onPress={takePhoto}>
                  <View style={styles.captureInner} />
                </TouchableOpacity>
                {captured.length > 0 ? (
                  <TouchableOpacity style={styles.sendBtnCamera} onPress={confirmPhotos}>
                    <Feather name="arrow-up" size={20} color="#FFF" />
                    <Text style={styles.sendCountText}>{captured.length}</Text>
                  </TouchableOpacity>
                ) : (
                  <TouchableOpacity style={styles.galleryBtnCamera} onPress={pickFromGallery}>
                    <Feather name="image" size={22} color="#888" />
                  </TouchableOpacity>
                )}
              </View>
            </>
          )}
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  inlineButtons: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  iconBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: 'center',
    alignItems: 'center',
  },

  // Camera modal
  cameraContainer: {
    flex: 1,
    backgroundColor: '#000',
  },
  cameraFull: {
    flex: 1,
  },
  viewfinderOverlay: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  viewfinder: {
    width: 260,
    height: 260,
    borderRadius: radius.xl,
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.3)',
  },
  hint: {
    color: 'rgba(255,255,255,0.5)',
    fontSize: 14,
    marginTop: spacing.md,
    textAlign: 'center',
    paddingHorizontal: spacing.lg,
  },
  cameraControls: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'center',
    paddingVertical: spacing.lg,
    paddingBottom: 50,
    backgroundColor: '#000',
  },
  closeBtn: {
    width: 50,
    height: 50,
    justifyContent: 'center',
    alignItems: 'center',
  },
  captureBtn: {
    width: 72,
    height: 72,
    borderRadius: 36,
    borderWidth: 3,
    borderColor: '#FFF',
    justifyContent: 'center',
    alignItems: 'center',
  },
  captureInner: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#FFF',
  },
  galleryBtnCamera: {
    width: 50,
    height: 50,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: '#444',
  },
  sendBtnCamera: {
    width: 50,
    height: 50,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 25,
    backgroundColor: '#333',
  },
  sendCountText: {
    color: '#FFF',
    fontSize: 10,
    fontWeight: '700',
    marginTop: 2,
  },

  // Thumbnail strip
  thumbStrip: {
    position: 'absolute',
    bottom: 80,
    left: 0,
    right: 0,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  thumbStripCamera: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: '#000',
  },
  thumbImg: {
    width: 52,
    height: 52,
    borderRadius: 6,
    marginRight: 6,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.3)',
  },

  // Preview actions
  previewActions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    padding: spacing.md,
    paddingBottom: 50,
    backgroundColor: '#000',
    gap: spacing.sm,
  },
  previewBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 14,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: '#555',
  },
  previewBtnText: {
    color: '#FFF',
    fontSize: 14,
    fontWeight: '500',
  },
  confirmBtn: {
    flex: 1.5,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 14,
    borderRadius: radius.md,
    backgroundColor: '#000',
    borderWidth: 1,
    borderColor: '#FFF',
  },
  confirmBtnText: {
    color: '#FFF',
    fontSize: 14,
    fontWeight: '700',
  },
});
