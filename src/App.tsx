/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef, useEffect } from 'react';
import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile, toBlobURL } from '@ffmpeg/util';
import { motion, AnimatePresence } from 'motion/react';
import { 
  FileAudio, 
  Upload, 
  Trash2, 
  Download, 
  Settings2, 
  CheckCircle2, 
  AlertCircle, 
  Loader2,
  Music,
  ChevronRight,
  Play
} from 'lucide-react';
import { cn } from '@/src/lib/utils';

interface AudioFile {
  id: string;
  file: File;
  status: 'pending' | 'converting' | 'completed' | 'error';
  progress: number;
  outputUrl?: string;
  outputName?: string;
  error?: string;
  originalSize: number;
  outputSize?: number;
}

type OutputFormat = 'mp3' | 'opus';
type Bitrate = 'auto' | '128k' | '192k' | '256k' | '320k';

export default function App() {
  const [files, setFiles] = useState<AudioFile[]>([]);
  const [format, setFormat] = useState<OutputFormat>('mp3');
  const [bitrate, setBitrate] = useState<Bitrate>('auto');
  const [isReady, setIsReady] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadProgress, setLoadProgress] = useState(0);
  const [isStuck, setIsStuck] = useState(false);
  const [isConvertingAll, setIsConvertingAll] = useState(false);
  const ffmpegRef = useRef(new FFmpeg());
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    loadFFmpeg();
  }, []);

  const loadFFmpeg = async () => {
    setLoadError(null);
    setLoadProgress(0);
    setIsStuck(false);
    
    // Use latest stable version
    const baseURL = 'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/esm';
    const ffmpeg = ffmpegRef.current;
    
    ffmpeg.on('log', ({ message }) => {
      console.log('[FFmpeg Log]', message);
    });

    // Timeout detection (15 seconds)
    const timeoutId = setTimeout(() => {
      if (!isReady) {
        setIsStuck(true);
      }
    }, 15000);

    try {
      console.log('Starting FFmpeg load...');
      console.log('SharedArrayBuffer status:', !!window.SharedArrayBuffer);
      
      if (!window.SharedArrayBuffer) {
        console.warn('SharedArrayBuffer is missing. This is likely why it is stuck.');
      }

      const progressInterval = setInterval(() => {
        setLoadProgress(prev => {
          if (prev >= 90) {
            clearInterval(progressInterval);
            return 90;
          }
          return prev + 2;
        });
      }, 300);

      await ffmpeg.load({
        coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, 'text/javascript'),
        wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, 'application/wasm'),
      });
      
      clearTimeout(timeoutId);
      clearInterval(progressInterval);
      setLoadProgress(100);
      setIsReady(true);
      setIsStuck(false);
      console.log('FFmpeg loaded successfully!');
    } catch (err) {
      clearTimeout(timeoutId);
      console.error('Failed to load FFmpeg:', err);
      setLoadError('Koneksi gagal atau fitur browser diblokir.');
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      const newFiles = Array.from(e.target.files).map(file => ({
        id: Math.random().toString(36).substring(7),
        file,
        status: 'pending' as const,
        progress: 0,
        originalSize: (file as File).size
      }));
      setFiles(prev => [...prev, ...newFiles]);
    }
  };

  const removeFile = (id: string) => {
    setFiles(prev => prev.filter(f => f.id !== id));
  };

  const convertFile = async (audioFile: AudioFile) => {
    const ffmpeg = ffmpegRef.current;
    
    // Sanitize filenames for FFmpeg's virtual file system to avoid errors with spaces/special chars
    const fileExt = audioFile.file.name.split('.').pop();
    const inputName = `input_${audioFile.id}.${fileExt}`;
    const outputName = `output_${audioFile.id}.${format}`;
    const finalDownloadName = audioFile.file.name.replace(/\.[^/.]+$/, "") + `.${format}`;

    setFiles(prev => prev.map(f => f.id === audioFile.id ? { ...f, status: 'converting', progress: 0 } : f));

    try {
      console.log(`[AmbAudio] Processing: ${audioFile.file.name}`);
      
      // Write file to virtual FS
      const fileData = await fetchFile(audioFile.file);
      await ffmpeg.writeFile(inputName, fileData);
      
      ffmpeg.on('progress', ({ progress }) => {
        setFiles(prev => prev.map(f => f.id === audioFile.id ? { ...f, progress: Math.round(progress * 100) } : f));
      });

      const args = ['-i', inputName];

      if (bitrate === 'auto') {
        if (format === 'mp3') {
          // -q:a 0: Highest quality VBR
          // -id3v2_version 3: Best compatibility for Japanese characters (UTF-16)
          args.push('-codec:a', 'libmp3lame', '-q:a', '0', '-id3v2_version', '3', '-write_id3v1', '1');
        } else {
          // Opus high-fidelity settings
          args.push('-codec:a', 'libopus', '-vbr', 'on', '-compression_level', '10', '-frame_size', '20');
        }
      } else {
        args.push('-b:a', bitrate);
        if (format === 'mp3') args.push('-id3v2_version', '3');
      }

      args.push('-map_metadata', '0', outputName);

      console.log('[AmbAudio] Executing FFmpeg with args:', args);
      const result = await ffmpeg.exec(args);
      
      if (result !== 0) {
        throw new Error(`FFmpeg process exited with code ${result}`);
      }

      const data = await ffmpeg.readFile(outputName);
      const blob = new Blob([data as Uint8Array], { type: format === 'mp3' ? 'audio/mpeg' : 'audio/ogg' });
      const url = URL.createObjectURL(blob);

      setFiles(prev => prev.map(f => f.id === audioFile.id ? { 
        ...f, 
        status: 'completed', 
        progress: 100, 
        outputUrl: url, 
        outputName: finalDownloadName,
        outputSize: blob.size
      } : f));

      // Cleanup virtual FS to save memory
      await ffmpeg.deleteFile(inputName);
      await ffmpeg.deleteFile(outputName);
      console.log(`[AmbAudio] Successfully converted: ${finalDownloadName}`);
      
    } catch (err) {
      console.error('[AmbAudio] Conversion Error:', err);
      setFiles(prev => prev.map(f => f.id === audioFile.id ? { 
        ...f, 
        status: 'error', 
        error: err instanceof Error ? err.message : 'Conversion failed' 
      } : f));
    }
  };

  const convertAll = async () => {
    setIsConvertingAll(true);
    const pendingFiles = files.filter(f => f.status === 'pending');
    for (const file of pendingFiles) {
      await convertFile(file);
    }
    setIsConvertingAll(false);
  };

  const formatSize = (bytes: number) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const calculateReduction = (original: number, output?: number) => {
    if (!output) return null;
    const reduction = ((original - output) / original) * 100;
    return reduction.toFixed(1) + '%';
  };

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-white font-sans selection:bg-indigo-500/30">
      {/* Header */}
      <header className="border-b border-white/5 bg-black/50 backdrop-blur-xl sticky top-0 z-50">
        <div className="max-w-5xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-indigo-600 rounded-xl flex items-center justify-center shadow-lg shadow-indigo-500/20">
              <FileAudio className="w-6 h-6 text-white" />
            </div>
            <div>
              <h1 className="font-bold text-lg tracking-tight">AmbAudio</h1>
              <p className="text-[10px] text-white/40 uppercase tracking-widest font-medium">Client-Side Audio Engine</p>
            </div>
          </div>
          
          <div className="flex items-center gap-4">
            {loadError && (
              <div className="flex items-center gap-3">
                <span className="text-[10px] text-red-400 font-medium max-w-[200px] truncate">{loadError}</span>
                <button 
                  onClick={loadFFmpeg}
                  className="text-[10px] bg-red-500/20 hover:bg-red-500/30 text-red-400 px-2 py-1 rounded border border-red-500/30 transition-colors"
                >
                  Retry
                </button>
              </div>
            )}
            {!isReady && !loadError && (
              <div className="flex flex-col items-end gap-1">
                <div className="flex items-center gap-3 px-3 py-1.5 bg-white/5 rounded-full border border-white/10">
                  <div className="relative flex items-center justify-center">
                    <Loader2 className="w-3.5 h-3.5 animate-spin text-indigo-400" />
                    <span className="absolute text-[6px] font-bold text-indigo-400">{loadProgress}%</span>
                  </div>
                  <span className="text-xs font-medium text-white/60">Loading Engine...</span>
                </div>
                {isStuck && (
                  <span className="text-[9px] text-amber-400 font-medium animate-pulse">
                    Stuck? Coba buka aplikasi di Tab Baru ↗
                  </span>
                )}
              </div>
            )}
            {isReady && (
              <div className="flex items-center gap-2 px-3 py-1.5 bg-emerald-500/10 rounded-full border border-emerald-500/20">
                <div className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse" />
                <span className="text-xs font-medium text-emerald-400">Engine Ready</span>
              </div>
            )}
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-6 py-12">
        {/* Intro Section */}
        <div className="mb-12 text-center max-w-2xl mx-auto">
          <motion.h2 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-4xl font-bold mb-4 tracking-tight"
          >
            Compress Audio <span className="text-indigo-500">Without Compromise</span>
          </motion.h2>
          <motion.p 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="text-white/50 leading-relaxed"
          >
            Convert lossless WAV and FLAC files to optimized MP3 or Opus. 
            Everything happens in your browser—no files ever leave your device.
          </motion.p>
        </div>

        {/* Controls Bar */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
          <div className="bg-white/5 border border-white/10 rounded-2xl p-6 flex flex-col gap-4">
            <div className="flex items-center gap-2 text-white/60 mb-1">
              <Settings2 className="w-4 h-4" />
              <span className="text-xs font-bold uppercase tracking-wider">Output Format</span>
            </div>
            <div className="flex p-1 bg-black/40 rounded-xl border border-white/5">
              {(['mp3', 'opus'] as OutputFormat[]).map((f) => (
                <button
                  key={f}
                  onClick={() => setFormat(f)}
                  className={cn(
                    "flex-1 py-2 rounded-lg text-sm font-semibold transition-all uppercase tracking-wide",
                    format === f 
                      ? "bg-indigo-600 text-white shadow-lg" 
                      : "text-white/40 hover:text-white/60"
                  )}
                >
                  {f}
                </button>
              ))}
            </div>
          </div>

          <div className="bg-white/5 border border-white/10 rounded-2xl p-6 flex flex-col gap-4">
            <div className="flex items-center gap-2 text-white/60 mb-1">
              <Settings2 className="w-4 h-4" />
              <span className="text-xs font-bold uppercase tracking-wider">Target Bitrate</span>
            </div>
            <div className="flex p-1 bg-black/40 rounded-xl border border-white/5">
              {(['auto', '128k', '192k', '256k', '320k'] as Bitrate[]).map((b) => (
                <button
                  key={b}
                  onClick={() => setBitrate(b)}
                  className={cn(
                    "flex-1 py-2 rounded-lg text-[10px] font-bold transition-all uppercase",
                    bitrate === b 
                      ? "bg-indigo-600 text-white shadow-lg" 
                      : "text-white/40 hover:text-white/60"
                  )}
                >
                  {b === 'auto' ? 'Original' : b}
                </button>
              ))}
            </div>
          </div>

          <div className="bg-white/5 border border-white/10 rounded-2xl p-6 flex flex-col justify-center gap-4">
             <button
              disabled={!isReady || files.length === 0 || isConvertingAll}
              onClick={convertAll}
              className={cn(
                "w-full py-4 rounded-xl font-bold flex items-center justify-center gap-3 transition-all shadow-xl",
                !isReady || files.length === 0 || isConvertingAll
                  ? "bg-white/5 text-white/20 cursor-not-allowed border border-white/5"
                  : "bg-indigo-600 hover:bg-indigo-500 text-white shadow-indigo-500/20 active:scale-[0.98]"
              )}
            >
              {isConvertingAll ? (
                <Loader2 className="w-5 h-5 animate-spin" />
              ) : (
                <Play className="w-5 h-5 fill-current" />
              )}
              {isConvertingAll ? 'Converting...' : 'Start Batch Conversion'}
            </button>
          </div>
        </div>

        {/* Dropzone */}
        <div 
          onClick={() => fileInputRef.current?.click()}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            if (e.dataTransfer.files) {
              const newFiles = Array.from(e.dataTransfer.files).map(file => ({
                id: Math.random().toString(36).substring(7),
                file,
                status: 'pending' as const,
                progress: 0,
                originalSize: (file as File).size
              }));
              setFiles(prev => [...prev, ...newFiles]);
            }
          }}
          className="group relative border-2 border-dashed border-white/10 hover:border-indigo-500/50 rounded-3xl p-12 text-center transition-all cursor-pointer bg-white/[0.02] hover:bg-indigo-500/[0.02] mb-12"
        >
          <input 
            type="file" 
            multiple 
            accept=".wav,.flac" 
            className="hidden" 
            ref={fileInputRef}
            onChange={handleFileSelect}
          />
          <div className="flex flex-col items-center gap-4">
            <div className="w-16 h-16 bg-white/5 rounded-2xl flex items-center justify-center group-hover:scale-110 group-hover:bg-indigo-500/10 transition-all">
              <Upload className="w-8 h-8 text-white/20 group-hover:text-indigo-400 transition-colors" />
            </div>
            <div>
              <p className="text-xl font-bold mb-1">Drop audio files here</p>
              <p className="text-white/40 text-sm">Supports WAV and FLAC (Lossless)</p>
            </div>
            <button className="mt-2 px-6 py-2 bg-white/10 hover:bg-white/20 rounded-full text-sm font-semibold transition-colors">
              Browse Files
            </button>
          </div>
        </div>

        {/* File List */}
        <div className="space-y-4">
          <AnimatePresence mode="popLayout">
            {files.map((file) => (
              <motion.div
                key={file.id}
                layout
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                className="bg-white/5 border border-white/10 rounded-2xl p-5 flex items-center gap-6 group"
              >
                <div className="w-12 h-12 bg-black/40 rounded-xl flex items-center justify-center flex-shrink-0">
                  <Music className="w-6 h-6 text-indigo-400" />
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <h3 className="font-bold truncate text-sm">{file.file.name}</h3>
                    <span className="text-[10px] bg-white/10 px-2 py-0.5 rounded text-white/60 font-mono">
                      {formatSize(file.originalSize)}
                    </span>
                  </div>
                  
                  {file.status === 'converting' && (
                    <div className="w-full h-1.5 bg-black/40 rounded-full overflow-hidden mt-2">
                      <motion.div 
                        initial={{ width: 0 }}
                        animate={{ width: `${file.progress}%` }}
                        className="h-full bg-indigo-500"
                      />
                    </div>
                  )}

                  {file.status === 'completed' && (
                    <div className="flex items-center gap-3 mt-1">
                      <span className="text-[10px] text-emerald-400 font-bold flex items-center gap-1">
                        <CheckCircle2 className="w-3 h-3" />
                        Converted to {format}
                      </span>
                      <span className="text-[10px] text-white/40">
                        {formatSize(file.outputSize || 0)}
                      </span>
                      <span className="text-[10px] px-1.5 py-0.5 bg-emerald-500/10 text-emerald-400 rounded font-bold">
                        -{calculateReduction(file.originalSize, file.outputSize)}
                      </span>
                    </div>
                  )}

                  {file.status === 'error' && (
                    <span className="text-[10px] text-red-400 font-bold flex items-center gap-1 mt-1">
                      <AlertCircle className="w-3 h-3" />
                      {file.error}
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-3">
                  {file.status === 'completed' && file.outputUrl && (
                    <a 
                      href={file.outputUrl} 
                      download={file.outputName}
                      className="p-2.5 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 rounded-xl transition-colors"
                      title="Download"
                    >
                      <Download className="w-5 h-5" />
                    </a>
                  )}
                  
                  {file.status === 'pending' && (
                    <button 
                      onClick={() => convertFile(file)}
                      disabled={!isReady || isConvertingAll}
                      className="p-2.5 bg-indigo-500/10 hover:bg-indigo-500/20 text-indigo-400 rounded-xl transition-colors disabled:opacity-50"
                      title="Convert"
                    >
                      <ChevronRight className="w-5 h-5" />
                    </button>
                  )}

                  <button 
                    onClick={() => removeFile(file.id)}
                    className="p-2.5 bg-white/5 hover:bg-red-500/10 text-white/20 hover:text-red-400 rounded-xl transition-all"
                    title="Remove"
                  >
                    <Trash2 className="w-5 h-5" />
                  </button>
                </div>
              </motion.div>
            ))}
          </AnimatePresence>

          {files.length === 0 && (
            <div className="text-center py-12 text-white/20 italic">
              No files selected yet
            </div>
          )}
        </div>
      </main>

      {/* Footer */}
      <footer className="max-w-5xl mx-auto px-6 py-12 border-t border-white/5 text-center">
        <p className="text-xs text-white/30 font-medium">
          Powered by FFmpeg.wasm • 100% Private • No Server Required
        </p>
      </footer>
    </div>
  );
}
