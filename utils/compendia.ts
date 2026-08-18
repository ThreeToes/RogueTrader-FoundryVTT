import { mkdir, readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import yaml from "js-yaml";
import Datastore from "nedb";

const PACK_SRC = "./src/packs";
const PACK_DEST = "../packs";

async function purgeDatabase(database: Datastore) {
    await new Promise<void>((resolve, reject) => {
        database.remove({}, {multi: true}, (error) => {
            if(error) {
                reject(error);
                return;
            }

            database.persistence.compactDatafile();

            resolve();
        });
    });
}

async function buildPack(folder: string) {
    const filename = path.resolve(PACK_DEST, `${folder}.db`);

    const database = new Datastore({
        filename,
        autoload: true,
    });

    await purgeDatabase(database);

    const files = await readdir(path.join(PACK_SRC, folder));

    for (const file of files){
        if(!file.endsWith(".yaml")) continue;
        
        const filename = path.join(PACK_SRC, folder, file);
        const contents = await readFile(filename, "utf8");
        const documents = yaml.loadAll(contents);

        await new Promise<void>((resolve, reject) => {
            database.insert(documents, (error) => {
                if (error) {
                    reject(error);
                    return;
                }

                resolve();
            });
        });
    }
}

export async function compile() {
    await mkdir(PACK_DEST, {recursive: true});

    const entries = await readdir(PACK_SRC, {
        withFileTypes: true,
    });

    const folders = entries
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name);

    await Promise.all(folders.map(buildPack));
}
