import json,sys
for n in sys.argv[1:]:
    p=n+'.json'; d=json.load(open(p)); d['bone_scale']={'head':0.72}; json.dump(d,open(p,'w'),indent=1)
