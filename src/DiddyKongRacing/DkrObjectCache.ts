import { DataManager } from "./DataManager";

export class DkrObjectCache {
    private objectHeaders: any = {};
    private objectModels: any = {};

    constructor(private dataManager: DataManager) {
    }

    public getObjectHeader(index: number, callback: Function): void {
        if(!!this.objectHeaders[index]) {
            // Header was found in cache, so just return it.
            callback(this.objectHeaders[index]);
        } else {
            // Header was not found, so it needs to be loaded.
            this.dataManager.getObjectHeader(index).then((headerDataBuffer) => {
                if(!!this.objectHeaders[index]) {
                    // Header has already been loaded, so just return it.
                    callback(this.objectHeaders[index]);
                } else {
                    this.objectHeaders[index] = headerDataBuffer.createTypedArray(Uint8Array);
                    callback(this.objectHeaders[index]);
                }
            });
        }
    }

    public getObjectModel(index: number, callback: Function): void {
        if(!!this.objectModels[index]) {
            // Model was found in cache, so just return it.
            callback(this.objectModels[index]);
        } else {
            // Model was not found, so it needs to be loaded.
            this.dataManager.getObjectModel(index).then((modelDataBuffer) => {
                if(!!this.objectModels[index]) {
                    // Model has already been loaded, so just return it.
                    callback(this.objectModels[index]);
                } else {
                    this.objectModels[index] = modelDataBuffer;
                    callback(this.objectModels[index]);
                }
            });
        }
    }

    // Preloads object models & headers
    public preloadObjects(indices: Array<number>, callback: Function): void {
        let promises = new Array<Promise<any>>(indices.length);
        // Need to load all the headers first before I can get the models.
        for(let i = 0; i < indices.length; i++) {
            promises[i] = this.dataManager.getObjectHeader(indices[i]);
        }
        Promise.all(promises).then((out) => {
            let modelIds = new Set<number>();
            for (let index = 0; index < out.length; index++) {
                if(!this.objectHeaders[indices[index]]) {
                    let objectData = out[index].createTypedArray(Uint8Array);;
                    const dataView = new DataView(objectData.buffer);
                    let modelType = dataView.getUint8(0x53);
                    let numberOfModels = dataView.getUint8(0x55);
                    let modelIdsOffset = dataView.getInt32(0x10);
                    switch(modelType) {
                        case 0: // 3D Model
                            for(let i = 0; i < numberOfModels; i++) {
                                modelIds.add(dataView.getInt32(modelIdsOffset + (i*4)));
                            }
                            break;
                        case 1: // Billboarded sprite
                        case 2: // Vehicle part (Billboarded sprite)
                            break;
                    }
                    this.objectHeaders[indices[index]] = objectData;
                }
            }
            let modelIdsList = Array.from(modelIds);
            let modelPromises = new Array<Promise<any>>(modelIdsList.length);
            for(let i = 0; i < modelIdsList.length; i++) {
                modelPromises[i] = this.dataManager.getObjectModel(modelIdsList[i]);
            }
            Promise.all(modelPromises).then((outModels) => {
                for (let index = 0; index < outModels.length; index++) {
                    if(!this.objectModels[indices[index]]) {
                        this.objectModels[indices[index]] = outModels[index];
                    }
                }
                callback();
            });
        });
    }
}
