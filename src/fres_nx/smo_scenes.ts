
import * as Viewer from '../viewer';
import * as Yaz0 from '../compression/Yaz0';
import * as BYML from '../byml';

import Progressable from '../Progressable';
import { fetchData } from '../fetch';

import * as SARC from '../fres/sarc';
import * as BFRES from './bfres';
import { GfxDevice } from '../gfx/platform/GfxPlatform';
import { BRTITextureHolder, BasicFRESRenderer, FMDLRenderer, FMDLData } from './render';
import ArrayBufferSlice from '../ArrayBufferSlice';
import { assert, assertExists } from '../util';
import { mat4, quat, vec3 } from 'gl-matrix';

const basePath = `data/smo`;

class ResourceSystem {
    public textureHolder = new BRTITextureHolder();
    public mounts = new Map<string, SARC.SARC>();
    public bfresCache = new Map<string, BFRES.FRES | null>();
    public fmdlDataCache = new Map<string, FMDLData | null>();

    public loadResource(device: GfxDevice, mountName: string, sarc: SARC.SARC): void {
        assert(!this.mounts.has(mountName));
        this.mounts.set(mountName, sarc);

        // Look for and mount any textures.
        for (let i = 0; i < sarc.files.length; i++) {
            if (!sarc.files[i].name.endsWith('.bfres')) continue;
            // Sanity check: there should only be one .bfres per archive.
            assert(!this.bfresCache.has(mountName));

            const fres = BFRES.parse(sarc.files[i].buffer);
            this.bfresCache.set(mountName, fres);

            this.textureHolder.addFRESTextures(device, fres);
        }
    }

    public findFRES(mountName: string): BFRES.FRES | null {
        if (!this.bfresCache.has(mountName)) {
            console.log(`No FRES for ${mountName}`);
            this.bfresCache.set(mountName, null);
        }

        return this.bfresCache.get(mountName);
    }

    public getFMDLData(device: GfxDevice, mountName: string): FMDLData | null {
        if (!this.fmdlDataCache.has(mountName)) {
            const fres = this.findFRES(mountName);
            let fmdlData: FMDLData = null;
            if (fres !== null) {
                assert(fres.fmdl.length === 1);
                fmdlData = new FMDLData(device, fres.fmdl[0])
            }
            this.fmdlDataCache.set(mountName, fmdlData);
        }
        return this.fmdlDataCache.get(mountName);
    }

    public findBuffer(mountName: string, fileName: string): ArrayBufferSlice {
        const sarc = assertExists(this.mounts.get(mountName));
        return sarc.files.find((n) => n.name === fileName).buffer;
    }
}

type StageMap = { ObjectList: StageObject[] }[];
type Vector = { X: number, Y: number, Z: number };
type StageObject = {
    UnitConfigName: string,
    UnitConfig: UnitConfig,
    Rotate: Vector,
    Scale: Vector,
    Translate: Vector,
};
type UnitConfig = {
    DisplayName: string,
    DisplayRotate: Vector,
    DisplayScale: Vector,
    DisplayTranslate: Vector,
    GenerateCategory: string,
    ParameterConfigName: string,
    PlacementTargetFile: string,
};

const q = quat.create(), v = vec3.create(), s = vec3.create();
function calcModelMtxFromTRSVectors(dst: mat4, tv: Vector, rv: Vector, sv: Vector): void {
    quat.fromEuler(q, rv.X, rv.Y, rv.Z);
    vec3.set(v, tv.X, tv.Y, tv.Z);
    vec3.set(s, sv.X, sv.Y, sv.Z);
    mat4.fromRotationTranslationScale(dst, q, v, s);
}

class OdysseySceneDesc implements Viewer.SceneDesc {
    constructor(public id: string, public name: string = id) {
    }

    private _fetchSARC(arcPath: string): Progressable<SARC.SARC | null> {
        return fetchData(`${basePath}/${arcPath}`).then((buffer) => {
            if (buffer.byteLength === 0) return null;
            return Yaz0.decompress(buffer).then((buffer) => SARC.parse(buffer));
        });
    }

    private _shouldFetchWorldResource(r: string): boolean {
        // Don't bother fetching stuff we know won't exist.
        if (r.startsWith('SoundData/') || r.startsWith('SystemData/'))
            return false;

        // TODO(jstpierre): Maybe have a manifest so we don't need to make so many garbage HTTP requests?
        return true;
    }

    public createScene_Device(device: GfxDevice): Progressable<Viewer.Scene_Device> {
        const resourceSystem = new ResourceSystem();

        return this._fetchSARC(`SystemData/WorldList.szs`).then((worldListSARC) => {
            type WorldResource = { WorldName: string, WorldResource: { Ext: string, Name: string }[] };
            const worldResource: WorldResource[] = BYML.parse(worldListSARC.files.find((f) => f.name === 'WorldResource.byml').buffer);

            let resources = worldResource.find((r) => r.WorldName === this.id).WorldResource;
            resources = resources.filter((r) => this._shouldFetchWorldResource(r.Name));

            return Progressable.all(resources.map((r) => {
                return this._fetchSARC(`${r.Name}.${r.Ext}`).then((sarc: SARC.SARC | null) => {
                    if (sarc === null) return;
                    resourceSystem.loadResource(device, r.Name, sarc);
                });
            }));
        }).then(() => {
            // I believe this name is normally pulled from StageList.byml
            const worldHomeStageMapName = `${this.id}WorldHomeStageMap`;

            const worldHomeStageMap: StageMap = BYML.parse(resourceSystem.findBuffer(`StageData/${worldHomeStageMapName}`, `${worldHomeStageMapName}.byml`));
            console.log(worldHomeStageMap);

            // Construct scenario 0.
            const scenario = worldHomeStageMap[0];

            const sceneRenderer = new BasicFRESRenderer(resourceSystem.textureHolder);
            for (let i = 0; i < scenario.ObjectList.length; i++) {
                const stageObject = scenario.ObjectList[i];
                const fmdlData = resourceSystem.getFMDLData(device, `ObjectData/${stageObject.UnitConfigName}`);
                if (fmdlData === null) continue;
                const renderer = new FMDLRenderer(device, resourceSystem.textureHolder, fmdlData);
                calcModelMtxFromTRSVectors(renderer.modelMatrix, stageObject.Translate, stageObject.Rotate, stageObject.Scale);
                sceneRenderer.addFMDLRenderer(device, renderer);
            }
            return sceneRenderer;
        });
    }
}

// Splatoon Models
const name = "Super Mario Odyssey (Experimental)";
const id = "smo";
const sceneDescs: OdysseySceneDesc[] = [
    new OdysseySceneDesc('Cap'),
];

export const sceneGroup: Viewer.SceneGroup = { id, name, sceneDescs };
