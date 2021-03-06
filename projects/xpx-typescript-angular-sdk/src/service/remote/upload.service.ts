import { Injectable, Optional, Inject } from '@angular/core';
import { HttpClient, HttpHeaders, HttpParams } from '@angular/common/http';
import { map, catchError, switchMap, tap, mergeMap } from 'rxjs/operators';
import { UploadTextRequest } from '../../model/upload-text-request';
import { ResourceHashMessage } from '../../model/resource-hash-message';
import { flatbuffers } from 'flatbuffers';
import { decode, encode } from 'typescript-base64-arraybuffer';
import { Observable, noop, merge } from 'rxjs';
import { UploadBinaryRequest } from '../../model/upload-binary-request';
import { GenericResponseMessage } from '../../model/generic-response-message';
import { MessageType } from '../../model/message-type';
import { CustomHttpEncoder } from '../../model/custom-http-encoder';
import { SignedTransaction } from '../../model/signed-transaction';
import { PROXIMAX_REMOTE_BASE_URL, NEM_NETWORK } from '../../model/constants';
import { Helpers } from '../../utils/helpers';

import { RemoteTransactionAnnounceService } from './transaction-announce.service';
import { NetworkTypes, NEMLibrary } from 'nem-library';
import { Converter } from '../../utils/converter';

/**
 * Copyright 2018 ProximaX Limited
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * Class represents the remote upload service
 */
@Injectable({
  providedIn: 'root'
})
export class RemoteUploadService {
  // the default baseUrl
  private baseUrl = 'https://testnet2.gateway.proximax.io/';

  /**
   * The default NEM network
   */
  private nemNetwork = NetworkTypes.TEST_NET;

  /**
   * The instance of transaction announce service
   */
  private announceService: RemoteTransactionAnnounceService;

  /**
   * RemoteUploadService Constructor
   * @param http the HttpClient instance
   * @param baseUrl the optional baseUrl
   */
  constructor(
    private http: HttpClient,
    @Optional()
    @Inject(PROXIMAX_REMOTE_BASE_URL)
    baseUrl: string,
    @Optional()
    @Inject(NEM_NETWORK)
    netNetwork: NetworkTypes
  ) {
    if (baseUrl) {
      this.baseUrl = baseUrl;
    }

    if (netNetwork) {
      this.nemNetwork = netNetwork; // netNetwork.toUpperCase() === 'TEST_NET' ? NetworkTypes.TEST_NET : NetworkTypes.MAIN_NET;
    }

    this.announceService = new RemoteTransactionAnnounceService(
      this.http,
      this.baseUrl,
      this.nemNetwork
    );

    // clean up incase other service initial this NEMLibrary
    // NEMLibrary.reset();
    // NEMLibrary.bootstrap(this.nemNetwork);
  }

  /**
   * Uploads text to IPFS network
   * Example:
   *     service.uploadText(payload).subscribe((response) => {
   *        const rhm: ResourceHashMessage = response;
   *        const ipfsHash = rhm.hash();
   *     });
   *
   * @param payload the upload text request payload
   * @returns Observable<any>
   */
  private uploadTextToIPFS(
    payload: UploadTextRequest,
    returnHash: boolean
  ): Observable<any> {
    // request endpoint
    const endpoint = this.baseUrl + 'upload/text';

    if (payload === null) {
      throw new Error('The request payload could not be null');
    } else if (
      payload.text === null ||
      payload.text === undefined ||
      payload.text === ''
    ) {
      throw new Error('The request payload \'text\' field is required');
    } else if (!Helpers.isJSONString(payload.metadata)) {
      throw new Error(
        'The request payload \'metadata\' field must be a valid JSON'
      );
    }

    // request headers
    const headers = new HttpHeaders({
      'Content-Type': 'application/json',
      Accept: '*/*'
    });

    // request body
    // Let encode the payload text

    const encodedData = btoa(payload.text);
    // const hexData = Converter.utf8ToHex(encodedData);
    payload.text = encodedData;

    const bodyData = JSON.stringify(payload);

    console.log(bodyData);

    // response type
    const responseType = 'text';

    // return full response
    const observe = 'response';

    if (!returnHash) {
      return this.http.post(endpoint, bodyData, {
        responseType: responseType,
        headers: headers,
        observe: observe,
        reportProgress: true
      });
    } else {
      return this.http
        .post(endpoint, bodyData, {
          responseType: responseType,
          headers: headers,
          observe: observe,
          reportProgress: true
        })
        .pipe(
          map(res => {
            // decode base64 string
            const data = decode(res.body);

            // create buffer
            const dataBuffer = new flatbuffers.ByteBuffer(data);

            // deserialise the data buffer
            const resourceHash = ResourceHashMessage.getRootAsResourceHashMessage(
              dataBuffer
            );

            // console.log(resourceHash);
            // return the resource hash from IPFS network
            return resourceHash;
          }),
          catchError(Helpers.handleError)
        );
    }
  }

  /**
   * Uploads text to IPFS network and announce transaction to NEM network
   * Example:
   *     service.uploadText(payload).subscribe((response) => {
   *        const rhm: ResourceHashMessage = response;
   *        const ipfsHash = rhm.hash();
   *     });
   *
   * @param payload the upload text request payload
   * @returns Observable<any>
   */
  public uploadText(payload: UploadTextRequest): Observable<any> {
    return this.uploadTextToIPFS(payload, false).pipe(
      switchMap(rhm => {
        // console.log(rhm.body);
        const signTransaction = this.announceService.signTransaction(
          rhm.body,
          payload.senderPrivateKey,
          payload.recieverPublicKey,
          payload.messageType
        );
        // console.log(signTransaction);
        return this.announceService.announceTransaction(signTransaction);
      })
    );
  }

  /**
   * Uploads text to IPFS network only
   * @param payload the upload text request payload
   */
  public uploadTextToIFPSOnly(payload: UploadTextRequest): Observable<any> {
    return this.uploadTextToIPFS(payload, true);
  }

  /**
   * Uploads binary file to IPFS network
   * Example:
   *     service.uploadBinary(payload).subscribe((response) => {
   *        const rhm: ResourceHashMessage = response;
   *        const ipfsHash = rhm.hash();
   *     });
   *
   * @param payload the upload binary request payload
   * @returns Observable<any>
   */
  private uploadBinaryToIPFS(
    payload: UploadBinaryRequest,
    returnHash: boolean
  ): Observable<any> {
    // request endpoint
    const endpoint = this.baseUrl + 'upload/bytes/binary';

    if (payload === null) {
      throw new Error('The request payload could not be null');
    } else if (payload.data === null) {
      throw new Error('The request payload \'data\' field is required');
    } else if (!Helpers.isJSONString(payload.metadata)) {
      throw new Error(
        'The request payload \'metadata\' field must be a valid JSON'
      );
    }

    // request headers
    const headers = new HttpHeaders({
      'Content-Type': 'application/json',
      Accept: '*/*'
    });

    // request body
    const bodyData = JSON.stringify(payload);

    // response type
    const responseType = 'text';

    // return full response
    const observe = 'response';

    if (!returnHash) {
      return this.http.post(endpoint, bodyData, {
        responseType: responseType,
        headers: headers,
        observe: observe,
        reportProgress: true
      });
    } else {
      return this.http
        .post(endpoint, bodyData, {
          responseType: responseType,
          headers: headers,
          observe: observe,
          reportProgress: true
        })
        .pipe(
          map(res => {
            // decode base64 string
            const data = decode(res.body);

            // create buffer
            const dataBuffer = new flatbuffers.ByteBuffer(data);

            // deserialise the data buffer
            const resourceHash = ResourceHashMessage.getRootAsResourceHashMessage(
              dataBuffer
            );

            // console.log(resourceHash);
            // return the resource hash from IPFS network
            return resourceHash;
          }),
          catchError(Helpers.handleError)
        );
    }
  }

  /**
   * Uploads binary file to IPFS network
   * Example:
   *     service.uploadBinary(payload).subscribe((response) => {
   *        const rhm: ResourceHashMessage = response;
   *        const ipfsHash = rhm.hash();
   *     });
   *
   * @param payload the upload binary request payload
   * @returns Observable<any>
   */
  public uploadBinary(payload: UploadBinaryRequest): Observable<any> {
    const trxService = new RemoteTransactionAnnounceService(
      this.http,
      this.baseUrl,
      this.nemNetwork
    );

    return this.uploadBinaryToIPFS(payload, false).pipe(
      switchMap(rhm => {
        // console.log(rhm.body);
        const signTransaction = trxService.signTransaction(
          rhm.body,
          payload.senderPrivateKey,
          payload.recieverPublicKey,
          payload.messageType
        );
        // console.log(signTransaction);
        return trxService.announceTransaction(signTransaction);
      })
    );
  }

  /**
   * Uploads binary data to IPFS network only
   * @param payload the upload binary request
   */
  public uploadBinaryToIPFSOnly(payload: UploadBinaryRequest): Observable<any> {
    return this.uploadBinaryToIPFS(payload, true);
  }

  /**
   * NOTE: To be removed
   * Uploads base64 encoded string binary file to IPFS network
   * Example:
   *     service.uploadBinary(payload).subscribe((response) => {
   *        const rhm: ResourceHashMessage = response;
   *        const ipfsHash = rhm.hash();
   *     });
   *
   * @param payload the upload binary request payload
   * @deprecated DO NOT USE - END POINT REMOVED
   */
  private uploadBase64Binary(payload: UploadBinaryRequest): Observable<any> {
    // request endpoint
    const endpoint = this.baseUrl + 'upload/base64/binary';

    if (payload === null) {
      throw new Error('The request payload could not be null');
    } else if (payload.data === null) {
      throw new Error('The request payload \'data\' field is required');
    } else if (!Helpers.isJSONString(payload.metadata)) {
      throw new Error(
        'The request payload \'metadata\' field must be a valid JSON'
      );
    }

    // request headers
    const headers = new HttpHeaders({
      'Content-Type': 'application/json',
      Accept: '*/*'
    });

    // request body
    const bodyData = JSON.stringify(payload);

    // response type
    const responseType = 'text';

    // return full response
    const observe = 'response';

    return this.http
      .post(endpoint, bodyData, {
        responseType: responseType,
        headers: headers,
        observe: observe,
        reportProgress: true
      })
      .pipe(
        map(res => {
          // decode base64 string
          const data = decode(res.body);

          // create buffer
          const dataBuffer = new flatbuffers.ByteBuffer(data);

          // deserialise the data buffer
          const resourceHash = ResourceHashMessage.getRootAsResourceHashMessage(
            dataBuffer
          );

          // console.log(resourceHash);
          // return the resource hash from IPFS network
          return resourceHash;
        }),
        catchError(Helpers.handleError)
      );
  }

  /**
   * Note: To be removed
   * Uploads binary file to IFPS network, sign and announce to NEM network
   * Example:
   *     service.uploadSignAnnounce(payload).subscribe((response) => {
   *        const signedTxt: SignedTransaction = response.body;
   *     ;
   *     });
   *
   * @param pvkey the blockchain network private key
   * @param pubkey the blockchain network public key
   * @param messageType the message type either PLAIN or SECURE
   * @param payload the request payload for uploading binary file
   * @returns Observable<any>
   * @deprecated DO NOT USE - END POINT REMOVED
   */
  public uploadSignAnnounce(
    pvkey: string,
    pubkey: string,
    messageType: MessageType,
    payload: UploadBinaryRequest
  ): Observable<any> {
    // request endpoint
    const endpoint = this.baseUrl + 'upload/sign/announce';

    if (pvkey === null || pvkey === undefined) {
      throw new Error(
        'The private key is required for signing and announcing to the network.'
      );
    }

    if (pubkey === null || pubkey === undefined) {
      throw new Error(
        'The public key is required for signing and announcing to the network.'
      );
    }

    if (messageType === null || messageType === undefined) {
      throw new Error('The message type either PLAIN or SECURE is required.');
    }

    if (payload === null) {
      throw new Error('The request payload could not be null');
    } else if (payload.data === null) {
      throw new Error('The request payload \'data\' field is required');
    } else if (!Helpers.isJSONString(payload.metadata)) {
      throw new Error(
        'The request payload \'metadata\' field must be a valid JSON'
      );
    }

    // request headers
    const headers = new HttpHeaders({
      'Content-Type': 'application/json',
      Accept: '*/*',
      'x-pvkey': pvkey,
      'x-pubkey': pubkey,
      messageType: messageType
    });

    // request body
    const bodyData = JSON.stringify(payload);

    // return full response
    const observe = 'response';

    return this.http.post<SignedTransaction>(endpoint, bodyData, {
      headers: headers,
      observe: observe,
      reportProgress: true
    });
  }

  /**
   * Note: To be removed
   * Uploads binary file to IFPS network, sign and announce to NEM network
   *  Example:
   *     service.uploadSignAnnounce(payload).subscribe((response) => {
   *        const signedTxt: SignedTransaction = response.body;
   *     ;
   *     });
   *
   * @param pvkey the blockchain network private key
   * @param pubkey the blockchain network public key
   * @param messageType the message type either PLAIN or SECURE
   * @param file the binary file
   * @param keywords the keywords seperated by comma (,)
   * @param metadata the metadata in JSON format
   * @returns Observable<any>
   * @deprecated DO NOT USE - END POINT REMOVED
   */
  private uploadGenerateSign(
    pvkey: string,
    pubkey: string,
    messageType: MessageType,
    file: Blob,
    keywords?: string,
    metadata?: string
  ): Observable<any> {
    // request endpoint
    const endpoint = this.baseUrl + 'upload/generate-sign';

    if (pvkey === null || pvkey === undefined) {
      throw new Error(
        'The private key is required for signing and announcing to the network.'
      );
    }

    if (pubkey === null || pubkey === undefined) {
      throw new Error(
        'The public key is required for signing and announcing to the network.'
      );
    }

    if (messageType === null || messageType === undefined) {
      throw new Error('The message type either PLAIN or SECURE is required.');
    }

    if (file === null) {
      throw new Error('The request file is required');
    }

    // request headers
    const headers = new HttpHeaders({
      // NOTE: Need to disable the content-type in headerfor multipart/form-data.
      // This is a bug from httpClient that prevent the post method to send the form data
      // 'Content-Type': 'multipart/form-data',
      Accept: '*/*',
      'x-pvkey': pvkey,
      'x-pubkey': pubkey
    });

    // query params
    let queryParams = new HttpParams({ encoder: new CustomHttpEncoder() });
    if (keywords !== null) {
      queryParams = queryParams.set('keywords', keywords);
    }

    if (metadata !== null) {
      queryParams = queryParams.set('metadata', metadata);
    }

    if (messageType !== null) {
      queryParams = queryParams.set('messageType', messageType);
    }

    // upload file using multipart/form-data
    const formData = new FormData();
    formData.append('file', <any>file);

    // return full response
    const observe = 'response';

    return this.http.post<SignedTransaction>(endpoint, formData, {
      headers: headers,
      params: queryParams,
      observe: observe,
      reportProgress: true
    });
  }

  /**
   * Cleanup hash
   * Example:
   *   uploadCleanup(multihash).subscribe(reponse => {
   *        const result: GenericResponseMessage = response.body;
   *        console.log(result);
   *   });
   *
   * @param multihash the multihash
   */
  public uploadCleanup(multihash: string): Observable<any> {
    // request endpoint
    const endpoint = this.baseUrl + 'upload/cleanup';

    if (multihash === null || multihash === undefined) {
      throw new Error('Multihash is required');
    }

    // request headers
    const headers = new HttpHeaders({
      'Content-Type': 'application/json',
      Accept: '*/*'
    });

    // add to parameters
    const queryParams = new HttpParams({
      encoder: new CustomHttpEncoder()
    }).set('multihash', multihash);

    // return full response
    const observe = 'response';

    return this.http.post<GenericResponseMessage>(endpoint, null, {
      // responseType: responseType,
      headers: headers,
      params: queryParams,
      observe: observe,
      reportProgress: true
    });
  }
}
