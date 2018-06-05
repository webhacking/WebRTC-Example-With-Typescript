import * as socketIoClient from 'socket.io-client';
import 'webrtc-adapter';
import { fromEvent } from 'rxjs/internal/observable/fromEvent';
import { Observable } from 'rxjs/internal/Observable';
import { filter } from 'rxjs/internal/operators';
import { Subject } from 'rxjs/internal/Subject';

export enum SignalingType {
  Offer,
  Answer,
  Candidate
}

export interface MainConfiguration {
  socketEndPoint: string;
  socketPort: string;
}

export class ManagePeer {
  public peerConnection: RTCPeerConnection;
  public stream;
  public dataChannel;

  public constructor(public userSocketId: string, public socket) {
    this.peerConnection = new RTCPeerConnection({
      iceServers: [],
    });
    this.dataChannel = this.peerConnection.createDataChannel('chat');
    this.peerConnection.onicecandidate = (e) => {
      this.socket.emit('signaling', {
        to: this.userSocketId,
        from: this.socket.id,
        type: SignalingType.Candidate,
        data: e.candidate
      });
    };
  }

  static typeOfSignal(signalType) {
   return SignalingType[signalType];
  }

  public addStream(stream) {
    this.stream = stream;
    this.peerConnection.addStream(stream);
  }

  public connect() {
    this.peerConnection.createOffer()
      .then(offer => {
        this.peerConnection.setLocalDescription(offer).then(() => {
          this.socket.emit('signaling', {
            to: this.userSocketId,
            from: this.socket.id,
            type: SignalingType.Offer,
            data: offer
          });
        })
          .catch(err => console.error(err));
      })
      .catch((error) => {
        console.log('error', error);
      });
  }

  public addConnection(offer) {
    this.peerConnection.setRemoteDescription(new RTCSessionDescription(offer.data))
      .then(() => {
        return this.peerConnection.createAnswer();
      })
      .then(answer => {
        this.peerConnection.setLocalDescription(answer).then(() => {
          this.socket.emit('signaling', {
            to: offer.from,
            from: this.socket.id,
            type: SignalingType.Answer,
            data: answer
          });
        }).catch(err => console.error(err));
      });
  }
}

export default class Main<T> {
  private connectBtn: HTMLElement = document.getElementById('connect-me');
  private disConnectBtn: HTMLElement = document.getElementById('disconnect-me');
  private switchVideoBtn: HTMLElement = document.getElementById('switch-video-btn');
  private switchVoiceBtn: HTMLElement = document.getElementById('switch-voice-btn');
  private localVideoEle: HTMLVideoElement = <HTMLVideoElement>document.getElementById('local');
  private remoteVideoEle: HTMLVideoElement = <HTMLVideoElement>document.getElementById('remote');
  private chatInputForm: HTMLTextAreaElement = document.querySelector('.chat-area textarea');
  private chatList: HTMLElement = document.querySelector('.chat-list > ul');
  private socket: socketIoClient.Socket;
  private chatStream$: Observable<any>;
  private peers: Object = {};

  public constructor(configuration: MainConfiguration) {
    this.socket = socketIoClient.connect(configuration.socketEndPoint + ':' + configuration.socketPort);
    this.chatStream$ = fromEvent(this.chatInputForm, 'keypress');
    const userMedia = navigator.mediaDevices.getUserMedia({audio: true, video: true});

    this.socket.on('user-video-pause', (emitData) => {
      ( emitData.pause ) ? this.disableMediaOnVideoEle(this.remoteVideoEle, true) : this.enableMediaOnVideoEle(this.remoteVideoEle, true);
    });

    this.socket.on('user-audio-mute', (emitData) => {
      ( emitData.pause ) ? this.turnOffMediaAudio(this.remoteVideoEle, true) : this.turnOnMediaAudio(this.remoteVideoEle, true);
    });

    this.socket.on('user-leave', (userSocketId) => {
      if ( userSocketId in this.peers ) {
        this.peers[userSocketId].peerConnection.close();
        delete this.peers[userSocketId];
      }

      this.disableVideoController();
      this.chatInputForm.setAttribute('disabled', 'false');
      this.connectBtn.removeAttribute('disabled');
      this.disConnectBtn.removeAttribute('disabled');
    });

    this.socket.on('signaling', (signal) => {
      switch (signal.type) {
        case SignalingType.Offer:
        case SignalingType.Candidate:
          if (signal.type === SignalingType.Offer) {
            this.peers[signal.from] = new ManagePeer(signal.from, this.socket);
            this.peers[signal.from].dataChannel.onopen = (evnet) => {
              if (this.peers[signal.from].dataChannel.readyState === 'open') {
                this.chatStream$.pipe(
                  filter((stream) => {
                    return stream.keyCode === 13;
                  })
                )
                  .subscribe(stream => {
                    this.peers[signal.from].dataChannel.send(this.chatInputForm.value);
                    this.appendChatData({data: this.chatInputForm.value});
                    this.chatInputForm.value = '';
                  });
              }
            };
            this.peers[signal.from].peerConnection.ondatachannel = (event) => {
              event.channel.onmessage = (message) => {
                this.appendChatData(message);
              };
            };
          }
          userMedia.then(stream => {
            if (signal.type === SignalingType.Candidate) {
              if (signal.data !== null) {
                this.peers[signal.from].peerConnection.addIceCandidate(new RTCIceCandidate(signal.data)).then().catch(err => {
                  console.error(err);
                  console.log('trouble maker', signal);
                });
              }
            } else {
              this.peers[signal.from].addStream(stream);
              this.peers[signal.from].addConnection(signal);
              this.peers[signal.from].peerConnection.ontrack = (e) => {
                this.enableMediaOnVideoEle(this.remoteVideoEle, true);
                this.pipeMediaStream(this.remoteVideoEle, e.streams[0]);
              };
            }
          });
          break;
        case SignalingType.Answer:
          this.peers[signal.from].peerConnection.setRemoteDescription(new RTCSessionDescription(signal.data));
          this.peers[signal.from].peerConnection.ontrack = (e) => {
            this.enableMediaOnVideoEle(this.remoteVideoEle, true);
            this.pipeMediaStream(this.remoteVideoEle, e.streams[0]);
          };
          break;
      }
    });

    document.addEventListener('DOMContentLoaded', () => {
      this.connectBtn.addEventListener('click', () => {
        this.disConnectBtn.removeAttribute('disabled');
        this.socket.emit('join-call', 1);
        this.socket.on('search-users', (usersSocketId: Array<string>) => {
          userMedia.then(stream => {
            usersSocketId.forEach(socketId => {
              this.peers[socketId] = {};
              this.peers[socketId] = new ManagePeer(socketId, this.socket);
              this.peers[socketId].addStream(stream);
              this.peers[socketId].connect();
              this.peers[socketId].dataChannel.onopen = (event) => {
                if ( this.peers[socketId].dataChannel.readyState === 'open' ) {
                  this.chatStream$.pipe(
                    filter((stream) => {
                      return stream.keyCode === 13;
                    })
                  )
                    .subscribe(stream => {
                      this.peers[socketId].dataChannel.send(this.chatInputForm.value);
                      this.appendChatData({data: this.chatInputForm.value});
                      this.chatInputForm.value = '';
                    });
                }
                this.peers[socketId].peerConnection.ondatachannel = (event) => {
                  event.channel.onmessage = (message) => {
                    this.appendChatData(message);
                  };
                };
              };
            });
          });
        });
        this.enableVideoController();
        this.connectBtn.setAttribute('disabled', 'true');
        this.chatInputForm.disabled = false;
        this.enableMediaOnVideoEle(this.localVideoEle);
        userMedia.then(stream => this.pipeMediaStream(this.localVideoEle, stream));
        this.switchVideoBtn.addEventListener('click', () => {
          const isEnabled = (this.switchVideoBtn.getAttribute('data-switched') === 'enable');
          (isEnabled) ? this.disableMediaOnVideoEle(this.localVideoEle) : this.enableMediaOnVideoEle(this.localVideoEle);
          this.socket.emit('user-video-pause', {
            pause: isEnabled
          });
        });

        this.switchVoiceBtn.addEventListener('click', () => {
          const isEnabled = (this.switchVoiceBtn.getAttribute('data-switched') === 'enable');
          (isEnabled) ? this.turnOffMediaAudio(this.localVideoEle) : this.turnOnMediaAudio(this.localVideoEle);
          this.socket.emit('user-audio-mute', {
            pause: isEnabled
          });
        });
      });

      this.disConnectBtn.addEventListener('click', () => {
        if ( confirm('You sure ?') ) {
          this.socket.disconnect();
          this.disableVideoController();
          this.chatInputForm.setAttribute('disabled', 'false');
          this.connectBtn.removeAttribute('disabled');
          this.disConnectBtn.removeAttribute('disabled');
          this.remoteVideoEle.src = '';
        }
      });
    });
  }

  public enableMediaOnVideoEle(videoEle: HTMLVideoElement, remoteVideo: Boolean = false): void {
    videoEle.classList.add('tunes');
    if ( !remoteVideo ) {
      this.switchVideoBtn.setAttribute('data-switched', 'enable');
    }
    videoEle.play();
    document.querySelectorAll('.video-frame')[ ( remoteVideo ) ? 1 : 0 ].setAttribute('data-video-status', 'enable');
  }

  public pipeMediaStream(videoEle: HTMLVideoElement, stream: MediaStream): void {
    videoEle.srcObject = stream;
  }

  public disableMediaOnVideoEle(videoEle: HTMLVideoElement, remoteVideo: Boolean = false): void {
    videoEle.pause();
    videoEle.classList.remove('tunes');
    if ( !remoteVideo ) {
      this.switchVideoBtn.setAttribute('data-switched', 'disable');
    }
    document.querySelectorAll('.video-frame')[(remoteVideo) ? 1 : 0].setAttribute('data-video-status', 'disable');
  }

  public enableVideoController(): void {
    document.querySelector('.video-controller').setAttribute('data-use', 'true');
  }

  public disableVideoController(): void {
    document.querySelector('.video-controller').setAttribute('data-use', 'false');
  }

  public turnOffMediaAudio(videoEle: HTMLVideoElement, remoteVideo: Boolean = false): void {
    videoEle.muted = true;
    this.switchVoiceBtn.setAttribute('data-switched', 'disable');
    document.querySelectorAll('.mute-audio-screen')[(remoteVideo) ? 1 : 0].classList.add('enable');
  }

  public turnOnMediaAudio(videoEle: HTMLVideoElement, remoteVideo: Boolean = false): void {
    videoEle.muted = false;
    this.switchVoiceBtn.setAttribute('data-switched', 'enable');
    document.querySelectorAll('.mute-audio-screen')[(remoteVideo) ? 1 : 0].classList.remove('enable');
  }

  private appendChatData(chatData): void {
    const chatEle = document.createElement('li');
    chatEle.innerHTML = '<li>' + chatData.data + '</li>';
    this.chatList.appendChild(chatEle);
  }
}

const app = new Main({
  socketEndPoint: '10.0.1.39',
  socketPort: '8080'
});

