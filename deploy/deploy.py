#!/usr/bin/env python
# -*- coding: UTF-8 -*-

if __name__ == '__main__':
    import os, sys
    ptoject_root = os.path.abspath(os.path.join(os.path.dirname(sys.argv[0]), '..'))
    print ptoject_root

    rel = lambda *args: os.path.join(ptoject_root, *args)

    requirements = rel('requirements.pip')
    
    # Создание виртуального окружения
    from ve_setup import use_virtualenv
    ve = use_virtualenv(
        [rel('env')], 
        requirements=requirements
    )
             
    ve.install_requirements(requirements)
