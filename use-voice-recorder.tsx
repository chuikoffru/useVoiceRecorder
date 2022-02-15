import { useEffect, useReducer, useCallback } from "react";

declare global {
  interface Window {
    AudioContext: typeof AudioContext;
    webkitAudioContext: typeof AudioContext;
  }
}

export type RecordingStatus = "ready" | "recording" | "stopped" | "denied";

type ReturnedSig = {
  startRecording: () => Promise<void>;
  stopRecording: () => void;
  setRecordingStatus: (status: RecordingStatus) => void;
  statusRecording: RecordingStatus;
  clearRecording: () => void;
  isPlaying: boolean;
  startPlaying: (url?: string) => void;
  stopPlaying: () => void;
  duration: number;
  analyser: AnalyserNode | null;
};

type State = {
  statusRecording: RecordingStatus;
  isPlaying: boolean;
  recorder: MediaRecorder | null;
  player: HTMLAudioElement | null;
  stream: MediaStream | null;
  audioContext: AudioContext | null;
  analyser: AnalyserNode | null;
  source: MediaStreamAudioSourceNode | null;
  animationFrameId: number | null;
  byteFrequencyData: Uint8Array;
  data: Blob | null;
  url: string;
  duration: number;
};

type Actions =
  | { type: "recording/init"; payload: MediaRecorder | null }
  | { type: "recording/status"; payload: RecordingStatus }
  | { type: "recording/url"; payload: string }
  | { type: "recording/start" }
  | { type: "recording/stop" }
  | { type: "playing/url"; payload: HTMLAudioElement }
  | { type: "playing/start" }
  | { type: "playing/stop" }
  | { type: "stream/init"; payload: MediaStream | null }
  | { type: "duration/set"; payload: number }
  | { type: "context/init"; payload: AudioContext | null }
  | { type: "analyser/init"; payload: AnalyserNode | null }
  | { type: "frequency/set"; payload: Uint8Array }
  | { type: "frequency/frame"; payload: number | null }
  | { type: "source/init"; payload: MediaStreamAudioSourceNode | null };

const initState: State = {
  statusRecording: "ready",
  isPlaying: false,
  recorder: null,
  player: null,
  stream: null,
  audioContext: null,
  analyser: null,
  source: null,
  data: null,
  animationFrameId: null,
  byteFrequencyData: new Uint8Array(),
  url: "",
  duration: 0,
};

const reducer = (state: State, action: Actions): State => {
  switch (action.type) {
    case "recording/init":
      return { ...state, recorder: action.payload };
    case "recording/status":
      return { ...state, statusRecording: action.payload };
    case "recording/url":
      return { ...state, url: action.payload };
    case "recording/stop":
      return { ...state, statusRecording: "stopped" };
    case "recording/start":
      return { ...state, statusRecording: "recording" };
    case "playing/url":
      return { ...state, player: action.payload };
    case "playing/start":
      return { ...state, isPlaying: true };
    case "playing/stop":
      return { ...state, isPlaying: false };
    case "stream/init":
      return { ...state, stream: action.payload };
    case "duration/set":
      return { ...state, duration: action.payload };
    case "context/init":
      return { ...state, audioContext: action.payload };
    case "analyser/init":
      return { ...state, analyser: action.payload };
    case "frequency/set":
      return { ...state, byteFrequencyData: action.payload };
    case "frequency/frame":
      return { ...state, animationFrameId: action.payload };
    case "source/init":
      return { ...state, source: action.payload };
    default:
      return state;
  }
};

type Callback = (result: Blob, url: string) => void;

type Options = {
  timeLimit?: number;
  timeSlice?: number;
  enableByteMonitor?: boolean;
};

export const useVoiceRecorder = (cb: Callback, options?: Options): ReturnedSig => {
  const [state, dispatch] = useReducer(reducer, initState);
  /**
   * Возвращаем записанные данные, меняем статус и передаем в плеер
   */
  const finishRecording = useCallback(
    ({ data }: { data: Blob }) => {
      // Создаем уникальный url для записи
      const url = URL.createObjectURL(data);
      // Меняем статус записи
      dispatch({ type: "recording/stop" });
      // Записываем url в хранилище
      dispatch({ type: "recording/url", payload: url });
      // Передаем плеер в хранилище
      dispatch({ type: "playing/url", payload: new Audio(url) });
      // Передаем данные в колбэк
      cb(data, url);
    },
    [cb]
  );

  /**
   * Статуем запись с микрофона
   */
  const startRecording = async () => {
    console.log(`startRecording`);
    // Указываем дефолтный статус
    dispatch({ type: "recording/status", payload: "ready" });
    // Сбрасываем длительность
    dispatch({ type: "duration/set", payload: 0 });
    try {
      // Получаем аудио с микрофона
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      // Создаем аудио контекст, источник и анализатор
      const audioContext = new (window.AudioContext || window.webkitAudioContext)();
      const source = audioContext.createMediaStreamSource(stream);
      const analyser = audioContext.createAnalyser();
      analyser.smoothingTimeConstant = 0.5;
      analyser.fftSize = 32;
      source.connect(analyser);
      // Передаем стрим в стор
      dispatch({ type: "stream/init", payload: stream });
      // Передаем анализатор в стор
      dispatch({ type: "analyser/init", payload: analyser });
      // Передаем источник в стор
      dispatch({ type: "source/init", payload: source });
      // Передаем контекст в стор
      dispatch({ type: "context/init", payload: audioContext });
      // Передаем поток в рекордер
      const recorder = new MediaRecorder(stream);
      // Передаем рекордер в стор
      dispatch({ type: "recording/init", payload: recorder });
      // Меняем статус на активный
      dispatch({ type: "recording/start" });
      // Стартуем запись
      recorder.start();
      // Навешиваем обработчик доступности данных
      recorder.addEventListener("dataavailable", finishRecording);
    } catch (error) {
      dispatch({ type: "recording/status", payload: "denied" });
    }
  };

  /**
   * Остановить запись
   */
  const stopRecording = useCallback(() => {
    console.log(`stopRecording`);
    const recorder = state.recorder;
    if (recorder) {
      // Меняем статус
      dispatch({ type: "recording/stop" });
      // Останавливаем запись
      recorder.stop();
      // Убираем прослушиватель
      recorder.removeEventListener("dataavailable", finishRecording);
      // Отключаем стрим
      state.stream?.getTracks().forEach((track) => track.stop());
      // Удаляем стрим из хранилища
      dispatch({ type: "stream/init", payload: null });
      // Удаляем анализатор из стора
      dispatch({ type: "analyser/init", payload: null });
    }
  }, [finishRecording, state.recorder, state.stream]);

  const clearRecording = useCallback(() => {
    console.log(`clearRecording`);
    // Сбрасываем статус
    dispatch({ type: "recording/status", payload: "ready" });
    // Сбрасываем длительность
    dispatch({ type: "duration/set", payload: 0 });
    // Чистим url
    dispatch({ type: "recording/url", payload: "" });
    // Удаляем рекордер из стора
    dispatch({ type: "recording/init", payload: null });
    /* // Удаляем анализатор из стора
    dispatch({ type: "analyser/init", payload: null });
    // Удаляем источник из стора
    dispatch({ type: "source/init", payload: null });
    // Удаляем контекст из стора
    dispatch({ type: "context/init", payload: null }); */
  }, []);

  const setRecordingStatus = (payload: RecordingStatus) =>
    dispatch({ type: "recording/status", payload });

  /**
   * Воспроизвести запись
   */
  const startPlaying = (url?: string) => {
    if (url) {
      const player = new Audio(url);
      player.crossOrigin = "anonymous";
      // Запускаем плеер
      player.play();
      // Меняем статус по достижении конца трека
      player.addEventListener("ended", () => dispatch({ type: "playing/stop" }));
      dispatch({ type: "recording/url", payload: url });
      // Передаем плеер в хранилище
      dispatch({ type: "playing/url", payload: player });
      // Меняем статус
      dispatch({ type: "playing/start" });
    } else {
      const player = state.player;
      if (player) {
        // Меняем статус
        dispatch({ type: "playing/start" });
        // Запускаем плеер
        player.play();
        // Меняем статус по достижении конца трека
        player.addEventListener("ended", () => dispatch({ type: "playing/stop" }));
      }
    }
  };

  /**
   * Остановить воспроизведение
   */
  const stopPlaying = () => {
    const player = state.player;
    if (player) {
      // Меняем статус проигрывателя
      dispatch({ type: "playing/stop" });
      // Ставим на паузу
      player.pause();
      // Удаляем обработчик
      player.removeEventListener("ended", () => dispatch({ type: "playing/stop" }));
    }
  };

  /**
   * При размонтировании сбрасываем
   */
  useEffect(() => {
    return () => clearRecording();
  }, [clearRecording]);

  /**
   * Включаем таймер
   */
  useEffect(() => {
    let timerId: NodeJS.Timeout | undefined;
    // Если статус установлен на запись, и не запущен счетчик, запускаем
    if (state.statusRecording === "recording" && !timerId) {
      timerId = setInterval(
        () => dispatch({ type: "duration/set", payload: state.duration + 1 }),
        1000
      );
    } else {
      timerId && clearInterval(timerId);
    }
    // Если установлен лимит времени, прекращаем запись по достижению лимита
    if (options?.timeLimit) {
      if (state.statusRecording === "recording" && state.duration >= options.timeLimit) {
        stopRecording();
      }
    }

    return () => {
      timerId && clearInterval(timerId);
    };
  }, [options?.timeLimit, state.duration, state.statusRecording, stopRecording]);

  return {
    startRecording,
    stopRecording,
    clearRecording,
    setRecordingStatus,
    statusRecording: state.statusRecording,
    isPlaying: state.isPlaying,
    startPlaying,
    stopPlaying,
    duration: state.duration,
    analyser: state.analyser,
  };
};
