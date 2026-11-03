"""Synthetic fixtures only: these tests establish no ISL accuracy or human approval."""
from dataclasses import replace
import io
import json
from types import SimpleNamespace as NS
import zipfile
import joblib
import numpy as np
import pytest
from backend.app import dataset
from backend.sequence.schema import Contract, DIM, FRAMES, HolisticAdapter, SequenceBuffer, pack_result
from backend.sequence.archive import SequenceArchive
from backend.sequence.features import summarize, FEATURE_DIM
from backend.sequence.baseline import fit_baseline, save_baseline, ResearchRecognizer
from backend.tests.test_foundation import reviewed


@pytest.fixture
def contract():
    return Contract('synthetic-fixture-only', 'a'*64, '{}', False, 100)


def seq(seed=0):
    return np.random.default_rng(seed).uniform(.1,.9,(FRAMES,DIM))


def result():
    def points(n, base):
        return NS(landmark=[NS(x=base+i/1000,y=.5,z=-.1,visibility=.9) for i in range(n)])
    return NS(pose_landmarks=points(33,.1), face_landmarks=points(468,.2),
              left_hand_landmarks=points(21,.3), right_hand_landmarks=points(21,.4))


def test_pack_dimensions_order_and_no_mutation():
    r = result()
    a = pack_result(r)
    assert a.shape == (DIM,) and a.dtype == np.float64
    np.testing.assert_allclose(a[[0,132,1536,1599]], [.1,.2,.3,.4])
    assert a[3] == .9
    r.left_hand_landmarks = None
    assert not pack_result(r)[1536:1599].any()
    r.face_landmarks.landmark.extend([r.face_landmarks.landmark[0]]*10)
    with pytest.raises(ValueError,match='468'): pack_result(r)


def test_adapter_explicit_rgb(contract):
    class Processor:
        def process(self, rgb):
            assert rgb.dtype == np.uint8
            return result()
    adapter = HolisticAdapter(Processor(), contract)
    np.testing.assert_array_equal(adapter.extract(np.zeros((8,8,3),dtype=np.uint8)),pack_result(result()))
    with pytest.raises(ValueError): adapter.extract(np.zeros((8,8,3)))
    with pytest.raises(ValueError): HolisticAdapter(object(),contract)
    for change in ({'input_mirrored':True},{'sample_period_ms':500},{'schema':'hands-v1'},
                   {'coordinates':'world'},{'missing':'interpolate'},{'model_sha256':'z'*64}):
        with pytest.raises(ValueError): replace(contract,**change)


@pytest.mark.parametrize('value', [np.zeros((30,128)), np.zeros((29,1662)),
                                  np.full((30,1662),np.nan),np.full((30,1662),'1')])
def test_invalid_sequence(value):
    with pytest.raises(ValueError): summarize(value)


def test_stats_deterministic_masked_and_motion():
    x = seq()
    before = x.copy()
    first = summarize(x)
    assert first.shape == (FEATURE_DIM,) == (508,)
    np.testing.assert_array_equal(first,summarize(x))
    np.testing.assert_array_equal(x,before)
    np.testing.assert_allclose(first[:63], x[:,1536:1599].mean(axis=0))
    assert not np.array_equal(first,summarize(x[::-1])) # Signed displacement preserves order.
    x[:,1536:1599] = 0
    assert not summarize(x)[:254].any()
    x[:]=0
    assert not summarize(x).any()
    # A dropout does not become a giant artificial velocity.
    x[:]=.5; x[10,1536:1599]=0
    assert not summarize(x)[189:252].any()


def test_buffer_take_identity_timing_reset_and_copy(contract):
    b = SequenceBuffer(contract)
    x = seq()
    for i in range(29): assert b.push(x[i],i*100,contract) is None
    out = b.push(x[29],2900,contract)
    np.testing.assert_array_equal(out,x)
    assert len(b.frames)==0
    a = x[0].copy(); b.push(a,3000,contract); a[:]=0
    assert b.frames[0].any()
    b.push(x[1],4000,contract) # Gap starts a fresh take, no interpolation.
    assert len(b.frames)==1
    with pytest.raises(ValueError): b.push(x[1],4000,contract)
    assert not b.frames
    b.push(x[0],4100,contract)
    assert b.push(np.zeros(DIM),4200,contract) is None
    assert not b.frames
    b.push(x[0],4300,contract)
    with pytest.raises(ValueError): b.push(x[1],4400,replace(contract,sample_period_ms=50))
    assert not b.frames
    with pytest.raises(ValueError): b.push(np.full(DIM,np.nan),4500,contract)
    other = SequenceBuffer(contract)
    assert not other.frames


def write_zip(path, *, missing=False, object_array=False):
    with zipfile.ZipFile(path,'w') as z:
        for i in range(29 if missing else 30):
            data = io.BytesIO()
            np.save(data,np.array([{}],dtype=object) if object_array else np.full(DIM,float(i)))
            z.writestr(f'MP_Data/i/me/0/{i}.npy',data.getvalue())


def test_zip_nested_label_order_and_pickle_rejected(tmp_path):
    p = tmp_path/'fixture.zip'; write_zip(p)
    a = SequenceArchive(p)
    assert list(a.index)==[('i/me','0')]
    np.testing.assert_array_equal(a.read('i/me','0')[:,0], np.arange(30))
    write_zip(p,missing=True)
    with pytest.raises(ValueError): SequenceArchive(p)
    write_zip(p,object_array=True)
    with pytest.raises(ValueError): SequenceArchive(p).read('i/me','0')


@pytest.mark.parametrize('name',['../bad.npy','/MP_Data/x/0/0.npy','MP_Data/x/00/0.npy'])
def test_bad_archive_paths(tmp_path,name):
    p = tmp_path/'bad.zip'
    with zipfile.ZipFile(p,'w') as z: z.writestr(name,b'bad')
    with pytest.raises(ValueError): SequenceArchive(p)


@pytest.fixture
def fit_inputs(reviewed,contract):
    entries = list(dataset.vocabulary().values())
    entries.append(dict(entries[0],label='SECOND_FIXTURE',reference_id='second-fixture'))
    dataset.VOCABULARY.write_text(json.dumps(entries))
    kwargs = dict(heldout_signers=['s3'],mapping={'source/a':'TEST_FIXTURE','source/b':'SECOND_FIXTURE'},
        contract=contract,evidence={'dataset_sha256':'b'*64,'source_url':'https://example.invalid/fixture',
            'provenance_evidence':'Synthetic test fixture only, not a real dataset.',
            'layout_evidence':'Synthetic test fixture only, no schema verification claim.',
            'capture_protocol_evidence':'Synthetic fixture only, no signer authenticity claim.',
            'contract_sha256':contract.fingerprint})
    return [seq(i) for i in range(6)], ['source/a','source/b']*3, ['s1','s1','s2','s2','s3','s3'],kwargs


def test_fit_serialization_and_inference_contract(fit_inputs,tmp_path,contract):
    xs,ys,groups,kwargs = fit_inputs
    b = fit_baseline(xs,ys,groups,**kwargs)
    path = tmp_path/'fixture-only.joblib'
    save_baseline(b,path)
    from backend.app.recognition import Recognizer
    with pytest.raises(ValueError, match='Unsupported model bundle'):
        Recognizer(path, dataset.vocabulary())
    model = ResearchRecognizer(path,contract)
    scores = model.score(xs[0],contract)
    np.testing.assert_allclose(list(scores['scores'].values()), b['model'].predict_proba([summarize(xs[0])])[0])
    assert scores['label'] is None and not scores['deployment_accepted']
    assert b['metrics']['train_signers']==['s1','s2'] and b['metrics']['test_signers']==['s3']
    with pytest.raises(ValueError): model.score(xs[0],replace(contract,sample_period_ms=50))
    b['feature_schema']='wrong'; joblib.dump(b,path)
    with pytest.raises(ValueError): ResearchRecognizer(path,contract)


def test_training_and_runtime_review_revocation(fit_inputs,tmp_path,contract):
    xs,ys,groups,kwargs=fit_inputs
    b=fit_baseline(xs,ys,groups,**kwargs)
    path=tmp_path/'fixture.joblib'; save_baseline(b,path)
    runtime=ResearchRecognizer(path,contract)
    dataset.VOCABULARY.write_text('[]')
    with pytest.raises(ValueError,match='Unapproved'): runtime.score(xs[0],contract)
    with pytest.raises(ValueError,match='Unapproved'): fit_baseline(xs,ys,groups,**kwargs)


def test_evidence_partition_and_duplicate_gates(fit_inputs):
    xs,ys,groups,kwargs=fit_inputs
    with pytest.raises(ValueError): fit_baseline(xs,ys,groups,**dict(kwargs,evidence={}))
    with pytest.raises(ValueError): fit_baseline(xs,ys,groups,**dict(kwargs,heldout_signers=[]))
    with pytest.raises(ValueError): fit_baseline(xs,ys,groups,**dict(kwargs,heldout_signers=['s4']))
    with pytest.raises(ValueError): fit_baseline(xs,ys,['']*6,**kwargs)
    with pytest.raises(ValueError): fit_baseline(xs,ys,groups,**dict(kwargs,mapping={'source/a':'TEST_FIXTURE'}))
    xs[4]=xs[0]
    with pytest.raises(ValueError,match='Duplicate'): fit_baseline(xs,ys,groups,**kwargs)
