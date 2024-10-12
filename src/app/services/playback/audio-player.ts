import { Injectable } from '@angular/core';
import { Observable, Subject } from 'rxjs';
import { Logger } from '../../common/logger';
import { MathExtensions } from '../../common/math-extensions';
import { PromiseUtils } from '../../common/utils/promise-utils';
import { StringUtils } from '../../common/utils/string-utils';
import { AudioPlayerBase } from './audio-player.base';

@Injectable()
export class AudioPlayer implements AudioPlayerBase {
    private _audio: HTMLAudioElement;
    private _audioContext: AudioContext;
    private _buffer: AudioBuffer | undefined = undefined;
    private _sourceNode: AudioBufferSourceNode | undefined = undefined;
    private _gainNode: GainNode;
    private _isPlayingOnWebAudio: boolean = false;
    private _webAudioStartTime: number = 0;
    private _webAudioOffset: number = 0;

    public constructor(
        private mathExtensions: MathExtensions,
        private logger: Logger,
    ) {
        this._audio = new Audio();
        this._audioContext = new AudioContext();
        this._gainNode = this._audioContext.createGain();
        this._gainNode.connect(this._audioContext.destination);

        try {
            // This fails during unit tests because setSinkId() does not exist on HTMLAudioElement
            // eslint-disable-next-line @typescript-eslint/ban-ts-comment
            // @ts-ignore
            // eslint-disable-next-line @typescript-eslint/no-unsafe-call
            this.audio.setSinkId('default');
        } catch (e: unknown) {
            // Suppress this error, but log it, in case it happens in production.
            this.logger.error(e, 'Could not perform setSinkId()', 'AudioPlayer', 'constructor');
        }

        this.audio.defaultPlaybackRate = 1;
        this.audio.playbackRate = 1;
        this.audio.volume = 1;
        this.audio.muted = false;

        this._gainNode.gain.setValueAtTime(1, 0);

        this.audio.onended = () => this.playbackFinished.next();
    }

    private playbackFinished: Subject<void> = new Subject();
    public playbackFinished$: Observable<void> = this.playbackFinished.asObservable();

    public get audio(): HTMLAudioElement {
        return this._audio;
    }

    public get progressSeconds(): number {
        if (this._isPlayingOnWebAudio) {
            return this._audioContext.currentTime - this._webAudioStartTime;
        } else {
            if (isNaN(this.audio.currentTime)) {
                return 0;
            }

            return this.audio.currentTime;
        }
    }

    public get totalSeconds(): number {
        if (this._isPlayingOnWebAudio) {
            return this._buffer?.duration || 0;
        } else {
            if (isNaN(this.audio.duration)) {
                return 0;
            }

            return this.audio.duration;
        }
    }

    public play(audioFilePath: string): void {
        this._isPlayingOnWebAudio = false;
        const playableAudioFilePath: string = this.replaceUnplayableCharacters(audioFilePath);
        this.audio.src = 'file:///' + playableAudioFilePath;
        PromiseUtils.noAwait(this.audio.play());
        PromiseUtils.noAwait(this.loadAudioWithWebAudio(playableAudioFilePath));
    }

    public stop(): void {
        if (this._isPlayingOnWebAudio) {
            if (this._sourceNode) {
                this._sourceNode.onended = () => {};
                this._sourceNode.stop();
                this._sourceNode.disconnect();
            }
        } else {
            this.audio.currentTime = 0;
            this.audio.pause();
        }
    }

    public pause(): void {
        if (this._isPlayingOnWebAudio) {
            // TODO
        } else {
            this.audio.pause();
        }
    }

    public resume(): void {
        if (this._isPlayingOnWebAudio) {
            // TODO
        } else {
            PromiseUtils.noAwait(this.audio.play());
        }
    }

    public setVolume(linearVolume: number): void {
        // log(0) is undefined. So we provide a minimum of 0.01.
        const logarithmicVolume: number = linearVolume > 0 ? this.mathExtensions.linearToLogarithmic(linearVolume, 0.01, 1) : 0;
        this.audio.volume = logarithmicVolume;
        this._gainNode.gain.setValueAtTime(logarithmicVolume, 0);
    }

    public mute(): void {
        this.audio.muted = true;
    }

    public unMute(): void {
        this.audio.muted = false;
    }

    public skipToSeconds(seconds: number): void {
        if (this._isPlayingOnWebAudio) {
            this.playWebAudio(seconds);
        } else {
            this.audio.currentTime = seconds;
        }
    }

    private replaceUnplayableCharacters(audioFilePath: string): string {
        // HTMLAudioElement doesn't play paths which contain # and ?, so we escape them.
        let playableAudioFilePath: string = StringUtils.replaceAll(audioFilePath, '#', '%23');
        playableAudioFilePath = StringUtils.replaceAll(playableAudioFilePath, '?', '%3F');
        return playableAudioFilePath;
    }

    private async fetchAudioFile(url: string): Promise<Blob> {
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`Failed to fetch audio file: ${response.statusText}`);
        }
        return await response.blob(); // Convert the response to a Blob
    }

    private async loadAudioWithWebAudio(audioFilePath: string): Promise<void> {
        this.fetchAudioFile(audioFilePath)
            .then((blob) => {
                const reader = new FileReader();
                reader.readAsArrayBuffer(blob);
                reader.onloadend = async () => {
                    const arrayBuffer = reader.result as ArrayBuffer;
                    this._buffer = await this._audioContext.decodeAudioData(arrayBuffer);
                    this.switchToWebAudio();
                };
            })
            .catch((error) => console.error(error));
    }

    private playWebAudio(offset: number): void {
        if (!this._buffer) {
            return;
        }

        try {
            // Make sure to stop any previous sourceNode if it's still playing
            if (this._sourceNode) {
                this._sourceNode.onended = () => {};

                this._sourceNode.stop();
                this._sourceNode.disconnect(); // Disconnect the previous node to avoid issues
            }

            // Create a new buffer source node
            this._sourceNode = this._audioContext.createBufferSource();
            this._sourceNode.buffer = this._buffer;

            // Connect the source node to the gain node
            this._sourceNode.connect(this._gainNode);

            this._sourceNode.onended = () => {
                this.playbackFinished.next();
            };

            this._isPlayingOnWebAudio = true;

            // Store the current time when audio starts playing
            this._webAudioStartTime = this._audioContext.currentTime - offset;

            // Store the offset for pausing and resuming
            this._webAudioOffset = offset;

            // Sync playback position with HTML5 Audio
            this._sourceNode.start(0, offset);
        } catch (error) {}
    }

    private switchToWebAudio(): void {
        // Get the current position of HTML5 audio
        const currentTime = this._audio.currentTime;

        // Pause the HTML5 Audio
        this._audio.pause();

        this.playWebAudio(currentTime);
    }
}
