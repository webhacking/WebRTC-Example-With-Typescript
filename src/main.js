"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
var socketIoClient = require("socket.io-client");
// const PeerConnection = new RTCPeerConnection({
//   bundlePolicy: 'balanced',
//   iceServers: [],
//   iceTransportPolicy: 'none',
//   peerIdentity: 'test'
// });
//
// PeerConnection.onicecandidate = () => {
// };
// PeerConnection.createOffer().then(offer => {
//   PeerConnection.setLocalDescription(offer);
// });
socketIoClient.connect('localhost:8080');
var connectBtn = document.getElementById('connect-me');
var disConnectBtn = document.getElementById('disconnect-me');
console.log('document', document);
document.addEventListener('DOMContentLoaded', function () {
    // connectBtn.addEventListener('click', () => {
    //   console.log('clicked');
    // });
});
//# sourceMappingURL=main.js.map